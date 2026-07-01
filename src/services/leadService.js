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
async function upsertClientByPhone(name, phone, email, source) {
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
          email: email || null,
          notes: `Manba: ${source}`
        }
      });
    } else if (email && !client.email) {
      // Agar mijoz topilsa va uning emaili bo'lmasa, uni yangilab qo'yamiz
      client = await tx.client.update({
        where: { id: client.id },
        data: { email: email }
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
  // Aniq maydonlarni so'raymiz: field_data (ism, telefon, email), created_time, ad_id, form_id
  const url = `https://graph.facebook.com/v25.0/${leadgenId}?fields=field_data,created_time,ad_id,form_id&access_token=${accessToken}`;
  
  console.log(`[Meta Webhook] Graph API v25.0 ga so'rov yuborilmoqda. LeadGen ID: ${leadgenId}`);
  
  const response = await fetch(url);
  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[Meta Webhook Error] Graph API javob xatosi. Status: ${response.status}, Body: ${errorText}`);
    throw new Error(`Meta Graph API call failed with status ${response.status}: ${errorText}`);
  }

  const leadData = await response.json();
  if (leadData && leadData.error) {
    console.error(`[Meta Webhook Error] Graph API xato qaytardi: ${leadData.error.message} (code: ${leadData.error.code})`);
    throw new Error(`Meta Graph API error: ${leadData.error.message} (code: ${leadData.error.code})`);
  }

  console.log(`[Meta Webhook] Graph API javobi olindi. field_data mavjud: ${!!leadData.field_data}, maydonlar soni: ${leadData.field_data ? leadData.field_data.length : 0}`);
  return leadData;
}

/**
 * Meta (Facebook/Instagram) Webhook POST so'rovini qayta ishlaydi.
 * 
 * @param {object} body - Express req.body ob'ekti
 * @param {function} broadcast - Real-time websocket xabarlarni tarqatuvchi funksiya
 */
async function handleMetaWebhook(body, broadcast) {
  console.log(`[Meta Webhook] ====== So'rov qabul qilindi. Object: ${body.object} ======`);

  if (body.object !== 'page') {
    console.log(`[Meta Webhook] Object "page" emas ("${body.object}"), o'tkazib yuboriladi.`);
    return;
  }

  for (const entry of body.entry) {
    console.log(`[Meta Webhook] Entry qayta ishlanmoqda. Page ID: ${entry.id}, changes soni: ${entry.changes ? entry.changes.length : 0}`);
    if (!entry.changes) continue;

    for (const change of entry.changes) {
      if (change.field === 'leadgen') {
        const leadgenId = change.value.leadgen_id;
        console.log(`[Meta Webhook] ▶ Yangi leadgen_id topildi: ${leadgenId}`);
        if (!leadgenId) {
          console.warn('[Meta Webhook Warn] leadgen_id bo\'sh, o\'tkazib yuboriladi.');
          continue;
        }

        try {
          // 1. Dublikatlarni oldini olish uchun leadgen_id tekshiruvi.
          console.log(`[Meta Webhook] Dublikat tekshirilmoqda. leadgen_id: ${leadgenId}`);
          const existingDeal = await prisma.deal.findFirst({
            where: { notes: { contains: `Meta LeadGen ID: ${leadgenId}` } }
          });

          if (existingDeal) {
            console.log(`[Meta Webhook] ⚠ Leadgen ID ${leadgenId} allaqachon qayta ishlangan (Deal ID: ${existingDeal.id}). O'tkazib yuboriladi.`);
            continue;
          }
          console.log(`[Meta Webhook] ✓ Dublikat topilmadi, davom etilmoqda.`);

          // Token tekshiruvi
          const accessToken = process.env.FB_PAGE_ACCESS_TOKEN || process.env.PAGE_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN;
          if (!accessToken) {
            console.error('[Meta Webhook Error] ✗ FB_PAGE_ACCESS_TOKEN, PAGE_ACCESS_TOKEN yoki META_ACCESS_TOKEN hech biri topilmadi! .env yoki Railway environment variables ni tekshiring.');
            continue;
          }
          const tokenSource = process.env.FB_PAGE_ACCESS_TOKEN ? 'FB_PAGE_ACCESS_TOKEN' : (process.env.PAGE_ACCESS_TOKEN ? 'PAGE_ACCESS_TOKEN' : 'META_ACCESS_TOKEN');
          console.log(`[Meta Webhook] ✓ Token topildi (${tokenSource} dan o'qildi, uzunligi: ${accessToken.length} belgi)`);

          // 2. Meta Graph API'dan ma'lumotlarni yuklab olish (v25.0)
          const leadData = await fetchMetaLeadDetails(leadgenId, accessToken);
          if (!leadData || !leadData.field_data) {
            console.warn(`[Meta Webhook Warn] Lead ${leadgenId} uchun field_data bo'sh yoki mavjud emas. Graph API javobi:`, JSON.stringify(leadData));
            continue;
          }

          let rawName = 'Nomsiz Lead';
          let rawPhone = '';
          let rawEmail = '';
          let rawProduct = 'Instagram Orqali Murojaat';

          leadData.field_data.forEach(field => {
            console.log(`[Meta Webhook]   field: ${field.name} = ${JSON.stringify(field.values)}`);
            if (field.name === 'full_name' || field.name === 'first_name') {
              rawName = field.values[0];
            }
            if (field.name === 'phone_number') {
              rawPhone = field.values[0];
            }
            if (field.name === 'email') {
              rawEmail = field.values[0];
            }
            if (field.name === 'product_name' || field.name === 'mahsulot') {
              rawProduct = field.values[0];
            }
          });

          console.log(`[Meta Webhook] Ajratilgan ma'lumotlar — Ism: ${rawName}, Tel: ${rawPhone}, Email: ${rawEmail}, Mahsulot: ${rawProduct}`);

          if (!rawPhone) {
            console.warn(`[Meta Webhook Warn] ⚠ Lead ${leadgenId} uchun telefon raqami topilmadi. Bu lead o'tkazib yuboriladi.`);
            continue;
          }

          // 3. Mijozni bazada tranzaksiya yordamida upsert qilish (dublikatsiz)
          console.log(`[Meta Webhook] Mijoz upsert qilinmoqda: Ism=${rawName}, Tel=${rawPhone}, Email=${rawEmail}`);
          const client = await upsertClientByPhone(rawName, rawPhone, rawEmail, 'Instagram Webhook');
          console.log(`[Meta Webhook] ✓ Mijoz tayyor. Client ID: ${client.id}, Ism: ${client.name}`);

          // 4. Voronka va Bosqichni topish
          const { pipelineId, stageId } = await getDefaultPipelineAndStage();
          console.log(`[Meta Webhook] Pipeline: ${pipelineId}, Stage: ${stageId}`);

          const formId = change.value.form_id || '';
          const adId = change.value.ad_id || '';

          if (pipelineId && stageId) {
            // 5. Sdelkani (Deal) yaratish
            console.log(`[Meta Webhook] Sdelka yaratilmoqda. Pipeline=${pipelineId}, Stage=${stageId}, Client=${client.id}`);
            const deal = await prisma.deal.create({
              data: {
                productName: String(rawProduct).trim().substring(0, 200),
                amount: 0,
                status: 'new',
                clientId: client.id,
                pipelineId,
                stageId,
                notes: `Meta LeadGen ID: ${leadgenId}\nForm ID: ${formId}\nAd ID: ${adId}`
              }
            });
            console.log(`[Meta Webhook] ✓ Sdelka muvaffaqiyatli saqlandi! Deal ID: ${deal.id}`);

            // Activity Log ga yozish
            try {
              await prisma.activityLog.create({
                data: {
                  action: 'Sdelka yaratildi',
                  details: `Meta Webhook orqali "${deal.productName}" sdelkasi yaratildi (LeadGen ID: ${leadgenId})`,
                  dealId: deal.id
                }
              });
            } catch (e) {
              console.warn(`[Meta Webhook Warn] Activity log yozishda xato (muhim emas): ${e.message}`);
            }

            // 6. UI ni real-vaqtda yangilash (Socket)
            if (broadcast) {
              broadcast({ type: 'deal_created', dealId: deal.id });
              console.log(`[Meta Webhook] ✓ WebSocket broadcast yuborildi. deal_created: ${deal.id}`);
            }

            console.log(`[Meta Webhook] ====== Lead muvaffaqiyatli qayta ishlandi: ${rawName} / ${rawPhone} ======`);
          } else {
            console.error(`[Meta Webhook Error] ✗ Pipeline yoki Stage topilmadi! Pipeline: ${pipelineId}, Stage: ${stageId}. Deals jadvaliga yozib bo'lmadi.`);
          }

        } catch (error) {
          console.error(`[Meta Webhook Async Error] ✗ Lead ${leadgenId} qayta ishlashda xato:`, error.message);
          console.error(`[Meta Webhook Async Error] Stack:`, error.stack);
          // Xato bo'lsa ham keyingi leadlar qayta ishlanishda davom etadi
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
