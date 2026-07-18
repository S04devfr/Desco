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

  // Dublikat yaratilishini oldini olish uchun tranzaksiyadan foydalanamiz (latency yuqori bo'lsa timeout bo'lmasligi uchun 15s)
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
  }, { timeout: 15000 });
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
  const apiVersion = process.env.META_API_VERSION || 'v25.0';
  const url = `https://graph.facebook.com/${apiVersion}/${leadgenId}?fields=field_data,created_time,ad_id,form_id&access_token=${accessToken}`;
  
  console.log(`[Meta Webhook] Graph API ${apiVersion} ga so'rov yuborilmoqda. LeadGen ID: ${leadgenId}`);
  
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

          if (existingDeal && leadgenId !== '444444444444' && leadgenId !== '444444444') {
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
          console.log(`[Meta Webhook] ✓ Token holati: ${accessToken ? 'Topildi' : 'Test Rejim (Token yoq)'}`);

          // 2. Meta Graph API'dan ma'lumotlarni yuklab olish
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
            console.log(`[Meta Webhook] \u2713 Sdelka muvaffaqiyatli saqlandi! Deal ID: ${deal.id}`);

            // 5.5. Telegram botga xabar yuborish (alohida try/catch — CRM ga ta'sir qilmaydi)
            try {
              await sendTelegramNotificationWithRetry({
                name: rawName,
                phone: rawPhone,
                formId: formId,
                pageName: `Meta (Ad ID: ${adId})`,
                leadId: leadgenId
              }, deal.id);
            } catch (tgErr) {
              console.warn(`[Telegram] Xabar yuborishda xato (muhim emas): ${tgErr.message}`);
            }

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
              const fullDeal = await prisma.deal.findUnique({
                where: { id: deal.id },
                include: {
                  client: { select: { id: true, name: true, company: true, phone: true, city: true } },
                  manager: { select: { id: true, fullName: true, email: true, role: true } },
                  stage: { select: { id: true, name: true, color: true, order: true } },
                  installments: { select: { id: true } }
                }
              });
              broadcast({ type: 'deal_created', dealId: deal.id, deal: fullDeal });
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

/**
 * Telefon raqamini normalizatsiya qiladi.
 * Agar O'zbekiston kodi bo'lsa standart +998XXXXXXXXX formatga keltiradi.
 * Agar xalqaro formatda bo'lsa (+ va 7-15 ta raqam), uni tasdiqlaydi.
 * Aks holda xato (validation error) qaytaradi.
 */
function normalizeUniversalPhone(raw) {
  if (!raw) {
    throw new Error('Telefon raqami kiritilishi shart (telefon/phone kiritilmagan).');
  }

  // Faqat raqamlar va plus belgisini saqlab qolamiz (nuqta, chiziq, qavs, bo'shliqlarni butunlay tozalaymiz)
  const digits = String(raw).replace(/\D/g, '');
  const hasPlus = String(raw).trim().startsWith('+');

  if (!digits || digits.length < 7) {
    throw new Error(`Telefon raqami juda qisqa yoki yaroqsiz: "${raw}"`);
  }

  // 1. O'zbekiston telefon formatlari
  if (digits.length === 9) {
    return '+998' + digits;
  }
  if (digits.length === 12 && digits.startsWith('998')) {
    return '+' + digits;
  }
  if (digits.length === 10 && digits.startsWith('8')) {
    return '+998' + digits.substring(1);
  }

  // 2. Boshqa xalqaro formatlar (7 tadan 16 tagacha raqamdan iborat)
  if (digits.length >= 7 && digits.length <= 16) {
    return '+' + digits;
  }

  throw new Error(`Telefon raqami formati noto'g'ri yoki yaroqsiz: "${raw}"`);
}

/**
 * Ichma-ich joylashgan (nested) obyektlarni bir tekis (flat) ko'rinishga keltiradi.
 * Bu fuzzy qidiruvni nested obyeklar uchun ham muammosiz ishlashini ta'minlaydi.
 */
function flattenObject(obj, prefix = '') {
  let result = {};
  if (!obj || typeof obj !== 'object') return result;

  for (const [key, val] of Object.entries(obj)) {
    const newKey = prefix ? `${prefix}.${key}` : key;
    if (val !== null && typeof val === 'object') {
      Object.assign(result, flattenObject(val, newKey));
    } else {
      result[newKey] = val;
    }
  }
  return result;
}

/**
 * Fuzzy qidiruv yordamida payload ichidagi kalit so'zlarga ko'ra qiymatni topadi.
 * Yuboraman.uz, Facebook va Make'dan keladigan dynamic, nested maydonlarni topishda yordam beradi.
 */
function findFuzzyValue(rawData, searchTerms, excludeTerms = []) {
  if (!rawData || typeof rawData !== 'object') return null;

  // Obyektni flat holatga keltiramiz (ichma-ich propertylar uchun)
  const flatData = flattenObject(rawData);
  const lowerExcludes = excludeTerms.map(t => t.toLowerCase());

  // Kalit so'zlarni istisno qilish tekshiruvi
  const isExcluded = (key) => {
    const lowerKey = key.toLowerCase();
    return lowerExcludes.some(exclude => lowerKey.includes(exclude));
  };

  // 1. Birinchi urinish: exact/cleaned moslik (bo'shliq va chiziqlarsiz)
  for (const term of searchTerms) {
    const cleanedTerm = term.toLowerCase().replace(/[\s_-]/g, '');
    for (const [key, val] of Object.entries(flatData)) {
      if (isExcluded(key)) continue;

      const parts = key.split('.');
      const leafKey = parts[parts.length - 1];
      const cleanedKey = leafKey.toLowerCase().replace(/[\s_-]/g, '');
      if (cleanedKey === cleanedTerm && val !== undefined && val !== null && String(val).trim() !== '') {
        return val;
      }
    }
  }

  // 2. Ikkinchi urinish: qisman (substring) moslik
  for (const term of searchTerms) {
    if (term.length < 3) continue;
    const lowerTerm = term.toLowerCase();
    for (const [key, val] of Object.entries(flatData)) {
      if (isExcluded(key)) continue;

      const lowerKey = key.toLowerCase();
      if (lowerKey.includes(lowerTerm) && val !== undefined && val !== null && String(val).trim() !== '') {
        return val;
      }
    }
  }
  return null;
}

/**
 * Kampaniya nomidan toza mahsulot nomini ajratib oladi.
 * Masalan: "rek 3 | 2.07 | Hadiya (1) | CBO| ABO" -> "Hadiya (1)"
 */
function extractProductName(campaignValue, defaultProduct = 'Universal Lead') {
  if (!campaignValue || String(campaignValue).trim() === '') return defaultProduct;
  
  // Agar butunlay raqamlardan iborat bo'lsa (masalan Form ID), default qaytaramiz
  if (/^\d+$/.test(String(campaignValue).trim())) return defaultProduct;

  const parts = String(campaignValue).split('|').map(p => p.trim());
  for (const part of parts) {
    const pLower = part.toLowerCase();
    const isDate = pLower.match(/^\d{1,2}[.-/]\d{1,2}/);
    const isCode = pLower.match(/^(?:rek|cbo|abo|adset|campaign|target|pixel|group|lead)\b/) || pLower.length <= 4;
    
    if (!isDate && !isCode && pLower.length > 2) {
      return part;
    }
  }
  return campaignValue;
}

/**
 * Kelgan payload'ni manbaga qarab umumiy formatga o'tkazadi (parse qiladi).
 * Yangi lead-manba qo'shilganda faqat shu funksiyada yangi case qo'shiladi.
 */
function parseLeadPayload(source, rawData) {
  const src = String(source).toLowerCase().trim();

  const name = findFuzzyValue(rawData, ['full_name', 'first_name', 'name', 'ism', 'user', 'client', 'mijoz', 'fio', 'f.i.o', 'buyurtmachi', 'customer', 'username'], ['campaign', 'product', 'form', 'ad', 'source', 'page', 'site', 'id']) || "Noma'lum";
  const phone = findFuzzyValue(rawData, ['phone_number', 'phone', 'telefon_raqami', 'telefon', 'tel', 'raqam', 'number', 'nomer', 'aloqa', 'contact'], ['form', 'ad', 'id', 'page', 'campaign']);
  const formId = findFuzzyValue(rawData, ['form_name', 'forma_nomi', 'form_id', 'form', 'forma', 'formId']) || (src === 'yuboraman' ? "Yuboraman Lead Form" : src === 'make' ? "Make Lead Form" : "General Lead Form");
  const pageName = findFuzzyValue(rawData, ['campaign_name', 'campaign', 'page_name', 'sahifa_nomi', 'page', 'sahifa', 'source', 'manba']) || (src === 'yuboraman' ? "Yuboraman.uz" : src === 'make' ? "Make.com" : "Webhook");
  const leadId = findFuzzyValue(rawData, ['lead_id', 'leadid', 'id']) || null;
  const city = findFuzzyValue(rawData, ['city', 'shahar', 'manzil', 'hudud', 'address', 'viloyat', 'rayon', 'qayerga', 'location'], ['campaign', 'product', 'form', 'ad', 'id']);

  const productNameFromPayload = findFuzzyValue(rawData, ['mahsulot', 'product', 'tovar', 'item', 'buyum', 'xizmat', 'kurs']);
  const defaultProductName = (pageName !== "Webhook" && pageName !== "Make.com" && pageName !== "Yuboraman.uz") ? pageName : formId;
  const productName = productNameFromPayload || defaultProductName;

  // Operatorga xalaqit beruvchi texnik maydonlarni izohdan (notes) o'chiramiz
  const additionalNotes = [];
  const isTechnicalField = (key) => {
    const k = key.toLowerCase().replace(/[\s_-]/g, '');
    
    // 1. Aniq mosliklar (exact matches)
    const exactTechKeys = [
      'id', 'leadid', 'formid', 'adid', 'adsetid', 'adsetname', 'platform',
      'source', 'sourceval', 'sourcetype', 'manba', 'sana', 'formname', 'formanomi',
      'fullname', 'firstname', 'lastname', 'name', 'ism', 'ismingiz',
      'phonenumber', 'phone', 'telefon', 'tel', 'raqam', 'nomer', 'number', 'aloqa', 'contact',
      'campaignname', 'campaign', 'pagename', 'page', 'sahifa', 'sahifanomi'
    ];
    if (exactTechKeys.includes(k)) return true;
    
    // 2. Maxsus tarkibiy kalitlar (compound keys)
    const compoundTechKeys = ['formid', 'leadid', 'adid', 'adset', 'platform', 'campaign', 'pagename', 'sourcetype'];
    if (compoundTechKeys.some(tk => k.includes(tk))) return true;

    // 3. Telefon va ism maydonlarini tarkibiy tekshirish
    const cleanWordList = key.toLowerCase().split(/[\s_()\-?]+/);
    const techWords = [
      'phone', 'telefon', 'tel', 'raqam', 'nomer', 'number', 'contact',
      'name', 'ism', 'fullname', 'firstname', 'lastname'
    ];
    if (cleanWordList.some(w => techWords.includes(w))) return true;

    return false;
  };

  const flatData = flattenObject(rawData);
  for (const [key, val] of Object.entries(flatData)) {
    if (val !== undefined && val !== null && String(val).trim() !== '' && !isTechnicalField(key)) {
      additionalNotes.push(`${key}: ${val}`);
    }
  }

  return {
    name: String(name).trim().substring(0, 200),
    phone: phone ? String(phone).trim() : null,
    formId: String(formId).trim().substring(0, 200),
    pageName: String(pageName).trim().substring(0, 200),
    productName: String(productName).trim().substring(0, 200),
    leadId: leadId ? String(leadId).trim() : null,
    city: city ? String(city).trim() : null,
    notes: additionalNotes.join('\n') || `Manba: ${pageName}`
  };
}

/**
 * Telegram Bot API'ga xabar yuborish (exponential backoff retry bilan).
 */
async function sendTelegramNotificationWithRetry(leadData, dealId) {
  // Foydalanuvchi talabiga ko'ra CRM Telegram boti orqali xabar yuborish vaqtincha o'chirib qo'yilgan
  console.log('[Telegram Notification] CRM Telegram boti yuborish to\'xtatilgan (skip).');
  return;

  const message = `
🔔 Yangi Lead (Universal Webhook)!

👤 Ism: ${leadData.name || "Noma'lum"}
📞 Telefon: ${leadData.phone || "Noma'lum"}
📋 Forma: ${leadData.formId || '-'}
🌐 Sahifa: ${leadData.pageName || '-'}
🆔 Lead ID: ${leadData.leadId || '-'}
🕒 Vaqt: ${new Date().toLocaleString('uz-UZ', { timeZone: 'Asia/Tashkent' })}
  `.trim();

  let attempt = 0;
  const maxAttempts = 3;
  let success = false;
  let lastError = '';

  while (attempt < maxAttempts && !success) {
    try {
      console.log(`[Telegram Notification] Xabar yuborish urinishi ${attempt + 1}/${maxAttempts} (Deal ID: ${dealId})...`);
      
      const response = await fetch(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: message
          })
        }
      );

      const result = await response.json();
      
      if (response.status === 429) {
        // Rate limit xatosi bo'lsa, Retry-After header'ni tekshiramiz yoki kutamiz
        const retryAfter = result.parameters?.retry_after || 5;
        console.warn(`[Telegram Rate Limit] 429 received. Waiting ${retryAfter} seconds...`);
        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
        attempt++;
        continue;
      }

      if (result.ok) {
        console.log(`[Telegram Notification] ✓ Xabar muvaffaqiyatli yuborildi (Deal ID: ${dealId})`);
        success = true;
      } else {
        throw new Error(result.description || 'Noma\'lum Telegram xatosi');
      }
    } catch (error) {
      attempt++;
      lastError = error.message;
      console.error(`[Telegram Error] Chaqiruvda xatolik (Urinish ${attempt}/${maxAttempts}):`, error.message);
      
      if (attempt < maxAttempts) {
        const delay = Math.pow(2, attempt) * 1000; // Exponential backoff (2s, 4s)
        console.log(`[Telegram Retry] Waiting ${delay}ms before next retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  // Agar barcha urinishlar muvaffaqiyatsiz tugasa, Deal'ni yangilaymiz va log yozamiz
  if (!success) {
    console.error(`[Telegram Notification Failure] Barcha urinishlar tugadi. Xato: ${lastError}`);
    
    try {
      // Sdelkani update qilish (notes maydoniga prepend qilish)
      const existingDeal = await prisma.deal.findUnique({ where: { id: dealId } });
      const currentNotes = existingDeal?.notes || '';
      await prisma.deal.update({
        where: { id: dealId },
        data: {
          notes: `[TELEGRAM YUBORILMADI (Xato: ${lastError})]\n${currentNotes}`
        }
      });

      // ActivityLog ga yozish
      await prisma.activityLog.create({
        data: {
          action: 'Telegram xabari yuborilmadi',
          details: `Sdelka #${dealId} uchun Telegram xabari yuborish 3 ta urinishda ham muvaffaqiyatsiz bo'ldi. Xato: ${lastError}`,
          dealId: dealId
        }
      });
      console.log(`[Telegram Notification Failure Logged] Sdelka va ActivityLog yangilandi.`);
    } catch (dbErr) {
      console.error('[Telegram Notification Failure Logger Error] DB ga yozishda xatolik:', dbErr.message);
    }
  }
}

/**
 * Universal webhook lead qabul qilish va saqlash funksiyasi.
 * Tranzaksiya xavfsizligi va dublikat (idempotency) himoyasini ta'minlaydi.
 */
async function handleUniversalLead(source, rawData, broadcast) {
  console.log(`[Universal Lead] Qabul qilindi. Source: ${source}. Data:`, JSON.stringify(rawData));

  // 1. Parsing
  let parsed;
  try {
    parsed = parseLeadPayload(source, rawData);
  } catch (parseErr) {
    console.error('[Universal Lead Parse Error] Payload parse qilishda xato:', parseErr.message);
    const err = new Error(`Payload parse qilishda xato: ${parseErr.message}`);
    err.statusCode = 400;
    throw err;
  }

  // Test lead (dry run) aniqlash
  const sourceVal = String(rawData.source || rawData.Source || rawData.source_type || '').toUpperCase();
  const nameVal = String(rawData.name || rawData.ism || rawData.full_name || rawData.fullName || parsed.name || '').toLowerCase();
  const phoneVal = String(rawData.phone || rawData.telefon || rawData.phone_number || rawData.phoneNumber || parsed.phone || '').toLowerCase();

  const isTest = 
    sourceVal === 'TEST' || 
    nameVal.includes('test lead') || 
    phoneVal.includes('test lead');

  if (isTest) {
    console.log(`[Universal Lead TEST] Test lead aniqlandi (Source: "${sourceVal}"). CRM ga yozish uchun sozlangan.`);
    
    // Test lead'lardagi dummy telefon raqamini to'g'ri formatdagi tasodifiy raqam bilan almashtiramiz
    // Bu orqali validatsiyadan o'tadi va 5 daqiqalik dublikat himoyasiga bloklanmaydi
    const randomDigits = Math.floor(1000000 + Math.random() * 9000000);
    parsed.phone = `+99899${randomDigits}`;
    
    if (parsed.name.toLowerCase().includes('test lead') || parsed.name === "Noma'lum") {
      parsed.name = `Test Lead (Yuboraman)`;
    }
  }

  // 2. Validatsiya & Fallback (Buzilmas va Lead yo'qotmaslik uchun fail-safe rejim)
  if (!parsed.name || parsed.name.trim() === "Noma'lum") {
    parsed.name = "Noma'lum Mijoz";
  }

  // Telefon normalizatsiyasi (Fail-safe: agar xato bo'lsa yoki bo'sh bo'lsa ham sdelkani barbir yaratadi)
  let cleanPhone = null;
  if (parsed.phone && parsed.phone.trim() !== '') {
    try {
      cleanPhone = normalizeUniversalPhone(parsed.phone);
    } catch (phoneErr) {
      console.warn(`[Universal Lead Fail-safe] Telefon raqamini normalizatsiya qilishda ogohlantirish: ${phoneErr.message}`);
      // Xato tashlamaymiz, shunchaki xom raqamni notes tarkibiga yozamiz
      parsed.notes = `[Yaroqsiz Telefon: ${parsed.phone}]\n${parsed.notes}`;
      cleanPhone = null;
    }
  } else {
    parsed.notes = `[Telefon raqami kiritilmagan]\n${parsed.notes}`;
  }

  // 3. Dublikat va Idempotency tekshiruvi (DB o'qish)
  // 3a. Agar leadId bo'lsa, notes tarkibida shu leadId bor-yo'qligini tekshiramiz
  if (parsed.leadId) {
    const duplicateDeal = await prisma.deal.findFirst({
      where: {
        notes: { contains: `Lead ID: ${parsed.leadId}` }
      }
    });

    if (duplicateDeal) {
      console.warn(`[Universal Lead Duplicate] Lead ID "${parsed.leadId}" allaqachon mavjud (Deal ID: ${duplicateDeal.id}).`);
      const err = new Error(`Ushbu so'rov (Lead ID: ${parsed.leadId}) allaqachon CRM'ga qo'shilgan.`);
      err.statusCode = 409;
      err.duplicateDealId = duplicateDeal.id;
      throw err;
    }
  }

  // 3b. Vaqt oynasi bo'yicha dublikat tekshiruvi (Oxirgi 5 daqiqa ichida bir xil telefon va forma)
  let clientForCheck = null;
  if (cleanPhone) {
    clientForCheck = await prisma.client.findFirst({
      where: { phone: cleanPhone }
    });
  }

  if (clientForCheck) {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const duplicateRecentDeal = await prisma.deal.findFirst({
      where: {
        clientId: clientForCheck.id,
        productName: parsed.formId,
        createdAt: { gte: fiveMinutesAgo }
      }
    });

    if (duplicateRecentDeal) {
      console.warn(`[Universal Lead Duplicate] Oxirgi 5 daqiqa ichida shu mijozdan bir xil forma bo'yicha murojaat kelgan.`);
      const err = new Error('Dublikat so\'rov: Oxirgi 5 daqiqa ichida ayni shu telefondan xuddi shu forma bo\'yicha murojaat yuborilgan.');
      err.statusCode = 409;
      err.duplicateDealId = duplicateRecentDeal.id;
      throw err;
    }
  }

  // 4. Tranzaksiya: Client va Deal yozuvlarini yaratish/topish (latency yuqori bo'lsa timeout bo'lmasligi uchun 15s)
  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
      // Mijozni qidiramiz
      let client = null;
      if (cleanPhone) {
        client = await tx.client.findFirst({
          where: { phone: { contains: cleanPhone } }
        });
      }

      if (!client) {
        client = await tx.client.create({
          data: {
            name: parsed.name,
            phone: cleanPhone,
            city: parsed.city || null,
            notes: `Manba: ${parsed.pageName} (Universal Webhook)`
          }
        });
        console.log(`[Universal Lead Transaction] Yangi mijoz yaratildi. ID: ${client.id}`);
      } else {
        // Agar mijoz topilsa va uning shahri bo'lmasa, uni yangilab qo'yamiz
        if (parsed.city && !client.city) {
          client = await tx.client.update({
            where: { id: client.id },
            data: { city: parsed.city }
          });
        }
        console.log(`[Universal Lead Transaction] Mavjud mijoz topildi. ID: ${client.id}`);
      }

      // Voronka va Bosqichni topamiz
      const pipeline = await tx.pipeline.findFirst({
        where: { isDefault: true },
        include: { stages: { orderBy: { order: 'asc' }, take: 1 } }
      });

      let targetStageId = null;
      let targetPipelineId = null;

      if (pipeline && pipeline.stages.length > 0) {
        targetPipelineId = pipeline.id;
        targetStageId = pipeline.stages[0].id;
      } else {
        const fallbackPipeline = await tx.pipeline.findFirst({
          include: { stages: { orderBy: { order: 'asc' }, take: 1 } }
        });
        if (fallbackPipeline && fallbackPipeline.stages.length > 0) {
          targetPipelineId = fallbackPipeline.id;
          targetStageId = fallbackPipeline.stages[0].id;
        }
      }

      // Sdelkani (Deal) yaratamiz
      const dealNotes = `Lead ID: ${parsed.leadId || 'N/A'}\nManba: ${parsed.pageName}\nQabul qilingan vaqt: ${new Date().toISOString()}\n\nTafsilotlar:\n${parsed.notes}`;
      
      const deal = await tx.deal.create({
        data: {
          productName: parsed.productName || parsed.formId || 'Universal Lead',
          amount: 0,
          status: 'new',
          clientId: client.id,
          pipelineId: targetPipelineId,
          stageId: targetStageId,
          notes: dealNotes
        }
      });
      console.log(`[Universal Lead Transaction] Sdelka yaratildi. ID: ${deal.id}`);

      // ActivityLog
      await tx.activityLog.create({
        data: {
          action: 'Sdelka yaratildi',
          details: `Universal Webhook (${source}) orqali sdelka yaratildi (Lead ID: ${parsed.leadId || 'N/A'})`,
          dealId: deal.id
        }
      });

      return { client, deal };
    }, { timeout: 15000 });
  } catch (dbErr) {
    console.error('[Universal Lead DB Transaction Error] Bazaga saqlashda xato:', dbErr.message);
    const err = new Error(`Ma'lumotlar bazasida xatolik: ${dbErr.message}`);
    err.statusCode = 500;
    throw err;
  }

  // 5. Asinxron Telegram xabarini yuborish (Tranzaksiyadan so'ng va DB xavfsiz holatda bo'lganida)
  // Bu asinxron bajariladi, shuning uchun lead qabul qilinganligi to'g'risidagi HTTP javobini kechiktirmaydi.
  sendTelegramNotificationWithRetry({
    name: parsed.name,
    phone: cleanPhone,
    formId: parsed.formId,
    pageName: parsed.pageName,
    leadId: parsed.leadId
  }, result.deal.id).catch(tgErr => {
    console.error('[Universal Lead Telegram Outer Error] Telegram zanjiridan kutilmagan xato:', tgErr.message);
  });

  // 6. Real-time UI yangilanish (WebSocket)
  if (broadcast) {
    try {
      const fullDeal = await prisma.deal.findUnique({
        where: { id: result.deal.id },
        include: {
          client: { select: { id: true, name: true, company: true, phone: true, city: true } },
          manager: { select: { id: true, fullName: true, email: true, role: true } },
          stage: { select: { id: true, name: true, color: true, order: true } },
          installments: { select: { id: true } }
        }
      });
      broadcast({ type: 'deal_created', dealId: result.deal.id, deal: fullDeal });
    } catch (wsErr) {
      console.warn('[Universal Lead WebSocket Broadcast Warn] UI ni yangilashda xato (muhim emas):', wsErr.message);
    }
  }

  return result;
}

module.exports = {
  upsertClientByPhone,
  getDefaultPipelineAndStage,
  fetchMetaLeadDetails,
  handleMetaWebhook,
  normalizeUniversalPhone,
  findFuzzyValue,
  extractProductName,
  parseLeadPayload,
  handleUniversalLead
};
