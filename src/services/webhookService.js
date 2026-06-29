const prisma = require('../config/database');
const supabase = require('../config/supabase');

/**
 * Telefon raqami bo'yicha mijozni qidiradi yoki tranzaksiya orqali xavfsiz yaratadi.
 * Bu ma'lumotlar dublikati hosil bo'lishining (race condition) oldini oladi.
 * 
 * @param {string} name - Mijoz ismi
 * @param {string} phone - Mijoz telefon raqami
 * @param {string} source - Manba nomi (masalan: "Instagram Webhook")
 * @returns {Promise<object>} Yaratilgan yoki topilgan mijoz ob'ekti
 */
async function upsertClientByPhone(name, phone, source) {
  const cleanPhone = phone.replace(/[\s-]/g, '');
  if (!cleanPhone) {
    throw new Error('Mijoz telefon raqami kiritilmagan.');
  }

  // Dublikat yaratilishini oldini olish uchun tranzaksiyadan foydalanamiz
  return await prisma.$transaction(async (tx) => {
    let client = await tx.client.findFirst({
      where: { phone: { contains: cleanPhone } }
    });

    if (!client) {
      client = await tx.client.create({
        data: {
          name: String(name).trim().substring(0, 200),
          phone: cleanPhone,
          notes: `Manba: ${source}`
        }
      });
    }

    return client;
  });
}

/**
 * Tizimdagi asosiy (default) voronka (pipeline) va uning birinchi bosqichini topadi.
 * Agar topilmasa, istalgan birinchi voronkani qaytaradi.
 * 
 * @returns {Promise<object>} { pipelineId, stageId } ob'ekti
 */
async function getDefaultPipelineAndStage() {
  const pipeline = await prisma.pipeline.findFirst({
    where: { isDefault: true },
    include: { stages: { orderBy: { order: 'asc' }, take: 1 } }
  });

  if (pipeline && pipeline.stages.length > 0) {
    return { pipelineId: pipeline.id, stageId: pipeline.stages[0].id };
  }

  const fallbackPipeline = await prisma.pipeline.findFirst({
    include: { stages: { orderBy: { order: 'asc' }, take: 1 } }
  });

  if (fallbackPipeline && fallbackPipeline.stages.length > 0) {
    return { pipelineId: fallbackPipeline.id, stageId: fallbackPipeline.stages[0].id };
  }

  return { pipelineId: null, stageId: null };
}

/**
 * Meta Graph API'dan Lead haqidagi to'liq ma'lumotlarni tortib oladi.
 * 
 * @param {string} leadgenId - Facebook leadgen_id si
 * @param {string} accessToken - Meta Page Access Token
 * @returns {Promise<object>} Meta qaytargan lead ma'lumotlari JSON ob'ekti
 */
async function fetchMetaLeadDetails(leadgenId, accessToken) {
  const url = `https://graph.facebook.com/v19.0/${leadgenId}?access_token=${accessToken}`;
  
  const response = await fetch(url);
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Meta Graph API call failed with status ${response.status}: ${errorText}`);
  }

  const leadData = await response.json();
  if (leadData && leadData.error) {
    throw new Error(`Meta Graph API error: ${leadData.error.message} (code: ${leadData.error.code})`);
  }

  return leadData;
}

/**
 * Meta (Facebook/Instagram) Webhook POST so'rovini qayta ishlaydi.
 * 
 * @param {object} body - Express req.body ob'ekti
 * @param {function} broadcast - Real-time websocket xabarlarni tarqatuvchi funksiya
 */
async function handleMetaWebhook(body, broadcast) {
  if (body.object !== 'page') return;

  for (const entry of body.entry) {
    if (!entry.changes) continue;

    for (const change of entry.changes) {
      // Faqat leadgen (forma to'ldirilgan) hodisalarini ushlaymiz
      if (change.field === 'leadgen') {
        const leadgenId = change.value.leadgen_id;
        if (!leadgenId) continue;

        try {
          const accessToken = process.env.PAGE_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN;
          if (!accessToken) {
            console.error('[Meta Webhook Error] PAGE_ACCESS_TOKEN topilmadi!');
            continue;
          }

          // 1. Meta Graph API'dan ma'lumotlarni yuklab olish
          const leadData = await fetchMetaLeadDetails(leadgenId, accessToken);
          if (!leadData || !leadData.field_data) continue;

          let rawName = 'Nomsiz Lead';
          let rawPhone = '';
          let rawProduct = 'Instagram Orqali Murojaat';

          leadData.field_data.forEach(field => {
            if (field.name === 'full_name' || field.name === 'first_name') {
              rawName = field.values[0];
            }
            if (field.name === 'phone_number') {
              rawPhone = field.values[0];
            }
            if (field.name === 'product_name' || field.name === 'mahsulot') {
              rawProduct = field.values[0];
            }
          });

          if (!rawPhone) {
            console.warn(`[Meta Webhook Warn] Lead ${leadgenId} uchun telefon raqami topilmadi.`);
            continue;
          }

          // 2. Mijozni bazada tranzaksiya yordamida upsert qilish (dublikatsiz)
          const client = await upsertClientByPhone(rawName, rawPhone, 'Instagram Webhook');

          // 3. Voronka va Bosqichni topish
          const { pipelineId, stageId } = await getDefaultPipelineAndStage();

          if (pipelineId && stageId) {
            // 4. Sdelkani (Deal) yaratish
            const deal = await prisma.deal.create({
              data: {
                productName: String(rawProduct).trim().substring(0, 200),
                amount: 0,
                status: 'new',
                clientId: client.id,
                pipelineId,
                stageId,
                notes: `Meta LeadGen ID: ${leadgenId}`
              }
            });

            // Activity Log ga yozish
            try {
              await prisma.activityLog.create({
                data: {
                  action: 'Sdelka yaratildi',
                  details: `Meta Webhook orqali "${deal.productName}" sdelkasi yaratildi`,
                  dealId: deal.id
                }
              });
            } catch (e) { /* ignore log errors */ }

            // 5. UI ni real-vaqtda yangilash (Socket)
            if (broadcast) {
              broadcast({ type: 'deal_created', dealId: deal.id });
            }

            console.log(`[Meta Webhook] Sdelka muvaffaqiyatli saqlandi: ${rawName} / ${rawPhone}`);
          }

        } catch (error) {
          // Meta webhook async jarayonida xatolikni konsolda ko'rsatish
          console.error(`[Meta Webhook Async Error] Lead ${leadgenId} qayta ishlashda xato:`, error.message);
        }
      }
    }
  }
}

module.exports = {
  upsertClientByPhone,
  getDefaultPipelineAndStage,
  fetchMetaLeadDetails,
  handleMetaWebhook
};
