const prisma = require('../config/database');
const supabase = require('../config/supabase');
const { sendPushToRole, sendPushToUser } = require('./pushService');
const { fixPostgresSequences } = require('../utils/sequenceSync');

/**
 * Telefon raqami bo'yicha mijozni qidiradi yoki tranzaksiya orqali xavfsiz yaratadi.
 * Bu ma'lumotlar dublikati hosil bo'lishining (race condition) oldini oladi.
 * 
 * @param {string} name - Mijoz ismi
 * @param {string} phone - Mijoz telefon raqami
 * @param {string} source - Manba nomi (masalan: "Instagram Webhook")
 * @returns {Promise<object>} Yaratilgan yoki topilgan mijoz ob'ekti
 */
function cleanLeadNotes(notes) {
  if (!notes) return null;
  let clean = String(notes)
    .replace(/^Lead ID:[^\r\n]*/gim, '')
    .replace(/^Manba:[^\r\n]*/gim, '')
    .replace(/^Qabul qilingan vaqt:[^\r\n]*/gim, '')
    .replace(/^Tafsilotlar:\s*/gim, '')
    .replace(/^Meta LeadGen ID:[^\r\n]*/gim, '')
    .replace(/^Form ID:[^\r\n]*/gim, '')
    .replace(/^Ad ID:[^\r\n]*/gim, '')
    .trim();
  return clean || null;
}

/**
 * Telefon raqami bo'yicha mijozni qidiradi yoki tranzaksiya orqali xavfsiz yaratadi.
 * Bu ma'lumotlar dublikati hosil bo'lishining (race condition) oldini oladi.
 */
async function upsertClientByPhone(name, phone, phone2 = null, email = null, source = 'webhook') {
  const cleanPhoneRaw = phone ? String(phone).replace(/[\s-]/g, '').trim() : null;
  const cleanPhone2Raw = phone2 ? String(phone2).replace(/[\s-]/g, '').trim() : null;

  if (!cleanPhoneRaw && !cleanPhone2Raw) {
    throw new Error('Mijoz telefon raqami kiritilmagan.');
  }

  const executeUpsertTx = async () => {
    return await prisma.$transaction(async (tx) => {
      let searchPhone = cleanPhoneRaw;
      if (searchPhone && !searchPhone.startsWith('+') && searchPhone.length === 12 && searchPhone.startsWith('998')) {
        searchPhone = '+' + searchPhone;
      }
      let searchPhone2 = cleanPhone2Raw;
      if (searchPhone2 && !searchPhone2.startsWith('+') && searchPhone2.length === 12 && searchPhone2.startsWith('998')) {
        searchPhone2 = '+' + searchPhone2;
      }

      const orConditions = [];
      if (cleanPhoneRaw) {
        orConditions.push({ phone: { contains: cleanPhoneRaw } });
        orConditions.push({ phone2: { contains: cleanPhoneRaw } });
      }
      if (cleanPhone2Raw) {
        orConditions.push({ phone: { contains: cleanPhone2Raw } });
        orConditions.push({ phone2: { contains: cleanPhone2Raw } });
      }

      let client = await tx.client.findFirst({
        where: { OR: orConditions }
      });

      if (!client) {
        client = await tx.client.create({
          data: {
            name: String(name).trim().substring(0, 200),
            phone: searchPhone || null,
            phone2: searchPhone2 || null,
            email: email || null,
            notes: null
          }
        });
      } else {
        const updateData = {};
        if (email && !client.email) updateData.email = email;
        if (searchPhone2 && !client.phone2 && client.phone !== searchPhone2) {
          updateData.phone2 = searchPhone2;
        }
        if (searchPhone && !client.phone && client.phone2 !== searchPhone) {
          updateData.phone = searchPhone;
        }
        if (Object.keys(updateData).length > 0) {
          client = await tx.client.update({
            where: { id: client.id },
            data: updateData
          });
        }
      }

      // ALSO upsert Contact
      let contact = await tx.contact.findFirst({
        where: { OR: orConditions }
      });

      if (!contact) {
        const cName = String(name).trim();
        const nameParts = cName.split(/\s+/);
        const firstName = nameParts[0] || "Nomsiz";
        const lastName = nameParts.slice(1).join(' ') || null;

        contact = await tx.contact.create({
          data: {
            firstName,
            lastName,
            phone: searchPhone || null,
            phone2: searchPhone2 || null,
            email: email || null
          }
        });
      } else {
        const cUpdateData = {};
        if (email && !contact.email) cUpdateData.email = email;
        if (searchPhone2 && !contact.phone2 && contact.phone !== searchPhone2) {
          cUpdateData.phone2 = searchPhone2;
        }
        if (searchPhone && !contact.phone && contact.phone2 !== searchPhone) {
          cUpdateData.phone = searchPhone;
        }
        if (Object.keys(cUpdateData).length > 0) {
          contact = await tx.contact.update({
            where: { id: contact.id },
            data: cUpdateData
          });
        }
      }

      return { client, contact };
    }, { timeout: 15000 });
  };

  try {
    return await executeUpsertTx();
  } catch (err) {
    if (err.message && (err.message.includes('Unique constraint') || err.code === 'P2002')) {
      console.warn('[UpsertClientByPhone] Sekvensiya (ID) ziddiyati aniqlandi. Sekvensiyalarni tiklab qayta urinilmoqda...');
      await fixPostgresSequences(prisma);
      return await executeUpsertTx();
    }
    throw err;
  }
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

          // Smart multi-phone extraction from leadData.field_data
          const fieldMap = {};
          leadData.field_data.forEach(field => {
            console.log(`[Meta Webhook]   field: ${field.name} = ${JSON.stringify(field.values)}`);
            fieldMap[field.name] = (field.values && field.values[0]) || '';
          });

          const phoneInfo = extractAllPhones(fieldMap);
          const rawName = fieldMap.full_name || fieldMap.first_name || 'Nomsiz Lead';
          const rawPhone = phoneInfo.cleanPhone || phoneInfo.rawPhone || fieldMap.phone_number || '';
          const rawPhone2 = phoneInfo.cleanPhone2 || phoneInfo.rawPhone2 || null;
          const rawEmail = fieldMap.email || '';
          const rawProduct = fieldMap.product_name || fieldMap.mahsulot || 'Instagram Orqali Murojaat';
          const cleanPhone = phoneInfo.cleanPhone || null;
          const cleanPhone2 = phoneInfo.cleanPhone2 || null;

          console.log(`[Meta Webhook] Ajratilgan ma'lumotlar — Ism: ${rawName}, Tel 1: ${rawPhone} (Clean: ${cleanPhone}), Tel 2: ${rawPhone2} (Clean: ${cleanPhone2}), Email: ${rawEmail}, Mahsulot: ${rawProduct}`);

          let client = null;
          let contact = null;

          if (cleanPhone || cleanPhone2 || (rawPhone && rawPhone.trim() !== '')) {
            try {
              const upsertRes = await upsertClientByPhone(rawName, cleanPhone || rawPhone, cleanPhone2 || rawPhone2, rawEmail, 'Instagram Webhook');
              client = upsertRes.client;
              contact = upsertRes.contact;
            } catch (phoneErr) {
              console.warn(`[Meta Webhook] upsertClientByPhone failed: ${phoneErr.message}`);
            }
          }

          if (!client) {
            // Create client without phone or with fallback
            client = await prisma.client.create({
              data: {
                name: rawName || "Noma'lum Mijoz",
                phone: cleanPhone || rawPhone || null,
                phone2: cleanPhone2 || rawPhone2 || null,
                email: rawEmail || null,
                notes: null
              }
            });
            
            contact = await prisma.contact.create({
              data: {
                firstName: rawName ? rawName.split(/\s+/)[0] : "Nomsiz",
                lastName: rawName ? rawName.split(/\s+/).slice(1).join(' ') : null,
                phone: cleanPhone || rawPhone || null,
                phone2: cleanPhone2 || rawPhone2 || null,
                email: rawEmail || null
              }
            });
            console.log(`[Meta Webhook] Yangi mijoz/kontakt yaratildi. Client ID: ${client.id}`);
          }

          // 4. Voronka va Bosqichni topish
          const { pipelineId, stageId } = await getDefaultPipelineAndStage();
          console.log(`[Meta Webhook] Pipeline: ${pipelineId}, Stage: ${stageId}`);

          const formId = change.value.form_id || '';
          const adId = change.value.ad_id || '';

          if (pipelineId && stageId) {
            // 5. Sdelkani (Deal) yaratish — HAR DOIM yaratiladi
            console.log(`[Meta Webhook] Sdelka yaratilmoqda. Pipeline=${pipelineId}, Stage=${stageId}, Client=${client.id}`);
            const dealNote = !cleanPhone && rawPhone ? `[⚠️ Telefon raqami tekshirish talab etiladi: ${rawPhone}]` : null;

            const deal = await prisma.deal.create({
              data: {
                productName: extractProductName(String(rawProduct).trim()).substring(0, 200),
                amount: 0,
                status: 'new',
                clientId: client.id,
                contactId: contact.id,
                pipelineId,
                stageId,
                notes: dealNote,
                source: 'target'
              }
            });
            console.log(`[Meta Webhook] ✓ Sdelka muvaffaqiyatli saqlandi! Deal ID: ${deal.id}`);

            // 5.5. Telegram botga xabar yuborish
            try {
              await sendTelegramNotificationWithRetry({
                name: rawName,
                phone: cleanPhone || rawPhone,
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
 * Dummy yoki noto'g'ri (fake) telefon raqamlarini aniqlaydi.
 * Masalan: "66666", "000000000", "111111111", "123456789"
 */
function isDummyOrInvalidPhone(raw) {
  if (!raw) return true;
  const digits = String(raw).replace(/\D/g, '');
  if (!digits || digits.length < 7) return true;
  
  // Bir xil takrorlanuvchi raqamlar: "66666", "000000000", "111111111", "999999999"
  if (/^(\d)\1+$/.test(digits)) return true;
  
  // Oddiy ketma-ketlik: "123456789", "987654321", "1234567"
  if ('01234567890123456789'.includes(digits) || '98765432109876543210'.includes(digits)) return true;
  
  // Test/dummy raqamlar
  if (digits === '998000000000' || digits === '998999999999' || digits === '998111111111') return true;
  
  return false;
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

  // Faqat raqamlar va plus belgisini saqlab qolamiz
  const digits = String(raw).replace(/\D/g, '');

  if (!digits || digits.length < 7) {
    throw new Error(`Telefon raqami juda qisqa yoki yaroqsiz: "${raw}"`);
  }

  // 1. O'zbekiston telefon formatlari
  // 9 xonali: 901234567 -> +998901234567
  if (digits.length === 9) {
    return '+998' + digits;
  }
  // 12 xonali: 998901234567 -> +998901234567
  if (digits.length === 12 && digits.startsWith('998')) {
    return '+' + digits;
  }
  // 10 xonali 8 yoki 0 bilan: 8901234567 yoki 0901234567 -> +998901234567
  if (digits.length === 10 && (digits.startsWith('8') || digits.startsWith('0'))) {
    return '+998' + digits.substring(1);
  }
  // 13 xonali 998 bilan: 998901234567X -> +998901234567
  if (digits.length === 13 && digits.startsWith('998')) {
    return '+' + digits.substring(0, 12);
  }

  // 2. Boshqa xalqaro formatlar (7 tadan 16 tagacha raqamdan iborat)
  if (digits.length >= 7 && digits.length <= 16) {
    return '+' + digits;
  }

  throw new Error(`Telefon raqami formati noto'g'ri yoki yaroqsiz: "${raw}"`);
}

/**
 * Payload'dagi barcha maydonlardan (standart telefon, maxsus savolnomalar,
 * ishlaydigan raqam, qo'shimcha telefon va h.k.) 1-chi va 2-chi telefon raqamlarini ajratib oladi.
 */
function extractAllPhones(rawData) {
  if (!rawData || typeof rawData !== 'object') {
    return {
      phone: null,
      phone2: null,
      cleanPhone: null,
      cleanPhone2: null,
      rawPhone: null,
      rawPhone2: null,
      isDummy: true
    };
  }

  const flatData = flattenObject(rawData);
  const candidates = [];

  const evaluateCandidate = (key, val) => {
    if (!val || typeof val === 'object') return;
    const strVal = String(val).trim();
    if (!strVal || strVal.length < 5) return;

    const lowerKey = String(key).toLowerCase();
    // Ad ID, Lead ID, Timestamp kabi 14+ xonali texnik ID larni e'tibordan chetda qoldiramiz
    if (lowerKey.includes('lead_id') || lowerKey.includes('leadid') || lowerKey.includes('ad_id') || lowerKey.includes('form_id') || lowerKey.includes('created_time') || lowerKey.includes('timestamp')) {
      return;
    }

    const digits = strVal.replace(/\D/g, '');
    let checkItems = [];

    // Agar butun qiymat asosan raqamdan iborat bo'lsa
    if (digits.length >= 7 && digits.length <= 15) {
      checkItems.push(digits);
    } else {
      // Agar qator matn ichida bo'lsa, regex orqali telefonlarni ajratib olamiz
      const phoneMatches = strVal.match(/(?:\+?998\s*\(?\d{2}\)?\s*\d{3}[\s.-]*\d{2}[\s.-]*\d{2})|(?:\b998\d{9}\b)|(?:\b\d{2}\s*\(?\d{2}\)?\s*\d{3}[\s.-]*\d{2}[\s.-]*\d{2}\b)|(?:\b8\s*\(?\d{2}\)?\s*\d{3}[\s.-]*\d{2}[\s.-]*\d{2}\b)|(?:\b\d{9,13}\b)/g) || [];
      checkItems = phoneMatches.map(m => m.replace(/\D/g, '')).filter(d => d.length >= 7 && d.length <= 15);
    }

    for (const itemDigits of checkItems) {
      if (!itemDigits || itemDigits.length < 5 || itemDigits.length > 15) continue;
      const isDummy = isDummyOrInvalidPhone(itemDigits);
      if (isDummy) continue;

      let normalized = null;
      try {
        normalized = normalizeUniversalPhone(itemDigits);
      } catch (e) {
        normalized = null;
      }

      let score = 0;
      let isSecondaryHint = false;

      const isStandardPhoneKey = (
        lowerKey === 'phone' ||
        lowerKey === 'phone_number' ||
        lowerKey === 'phonenumber' ||
        lowerKey === 'telefon' ||
        lowerKey === 'tel' ||
        lowerKey === 'raqam' ||
        lowerKey.endsWith('.phone') ||
        lowerKey.endsWith('.phone_number')
      );

      const isSecondaryKey = (
        lowerKey.includes('2') ||
        lowerKey.includes('ishlaydigan') ||
        lowerKey.includes('boshqa') ||
        lowerKey.includes('qoshimcha') ||
        lowerKey.includes('qo\'shimcha') ||
        lowerKey.includes('secondary') ||
        lowerKey.includes('extra') ||
        lowerKey.includes('ikkinchi') ||
        lowerKey.includes('telefon raqamingiz') ||
        lowerKey.includes('telefon_raqamingiz')
      );

      if (isStandardPhoneKey) score += 50;
      if (isSecondaryKey) {
        score += 45;
        isSecondaryHint = true;
      }
      if (normalized) {
        score += 40;
        if (normalized.startsWith('+998') && normalized.length === 13) {
          score += 30; // O'zbekiston mobil raqami (+998XXXXXXXXX)
        }
      }

      candidates.push({
        key,
        raw: strVal,
        digits: itemDigits,
        cleanPhone: normalized || (itemDigits ? `+${itemDigits}` : null),
        isDummy,
        score,
        isSecondaryHint
      });
    }
  };

  for (const [key, val] of Object.entries(flatData)) {
    evaluateCandidate(key, val);
  }

  // Saralash: Eng yuqori ballga ega nomzodlar oldinda
  candidates.sort((a, b) => b.score - a.score);

  // Unikal raqamlarni ajratib olish
  const uniqueList = [];
  const seenKeys = new Set();

  for (const c of candidates) {
    if (c.isDummy) continue;
    const identifier = c.cleanPhone || c.digits;
    if (!seenKeys.has(identifier)) {
      seenKeys.add(identifier);
      uniqueList.push(c);
    }
  }

  let first = null;
  let second = null;

  if (uniqueList.length === 1) {
    first = uniqueList[0];
  } else if (uniqueList.length >= 2) {
    // Agar ikkita raqam bo'lsa: standart 'phone' birinchi bo'lsin, ikkinchi savolnomadagi raqam 'phone2' bo'lsin
    const standardCandidate = uniqueList.find(c => !c.isSecondaryHint);
    const secondaryCandidate = uniqueList.find(c => c !== standardCandidate);

    if (standardCandidate && secondaryCandidate) {
      first = standardCandidate;
      second = secondaryCandidate;
    } else {
      first = uniqueList[0];
      second = uniqueList[1];
    }
  }

  return {
    phone: first ? (first.cleanPhone || first.raw) : null,
    cleanPhone: first ? first.cleanPhone : null,
    rawPhone: first ? first.raw : null,
    phone2: second ? (second.cleanPhone || second.raw) : null,
    cleanPhone2: second ? second.cleanPhone : null,
    rawPhone2: second ? second.raw : null,
    isDummy: !first
  };
}

/**
 * Universal extractor wrapper (backward compatibility)
 */
function extractBestPhone(rawData) {
  const res = extractAllPhones(rawData);
  return {
    rawPhone: res.rawPhone,
    cleanPhone: res.cleanPhone,
    isDummy: res.isDummy
  };
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
  
  // Smart Multi-Field Phone Extractor (1-chi va 2-chi telefon raqamlarini to'liq ajratib oladi)
  const phoneInfo = extractAllPhones(rawData);
  const rawFallbackPhone = findFuzzyValue(rawData, ['phone_number', 'phone', 'telefon_raqami', 'telefon', 'tel', 'raqam', 'number', 'nomer', 'aloqa', 'contact'], ['form', 'ad', 'id', 'page', 'campaign']);
  
  const chosenPhone = phoneInfo.cleanPhone || phoneInfo.rawPhone || (rawFallbackPhone ? String(rawFallbackPhone).trim() : null);
  const cleanPhone = phoneInfo.cleanPhone || null;
  const chosenPhone2 = phoneInfo.cleanPhone2 || phoneInfo.rawPhone2 || null;
  const cleanPhone2 = phoneInfo.cleanPhone2 || null;

  const formId = findFuzzyValue(rawData, ['form_name', 'forma_nomi', 'form_id', 'form', 'forma', 'formId']) || (src === 'yuboraman' ? "Yuboraman Lead Form" : src === 'make' ? "Make Lead Form" : "General Lead Form");
  const pageName = findFuzzyValue(rawData, ['campaign_name', 'campaign', 'page_name', 'sahifa_nomi', 'page', 'sahifa', 'source', 'manba']) || (src === 'yuboraman' ? "Yuboraman.uz" : src === 'make' ? "Make.com" : "Webhook");
  const leadId = findFuzzyValue(rawData, ['lead_id', 'leadid', 'id']) || null;
  const city = findFuzzyValue(rawData, ['city', 'shahar', 'manzil', 'hudud', 'address', 'viloyat', 'rayon', 'qayerga', 'location'], ['campaign', 'product', 'form', 'ad', 'id']);

  const productNameFromPayload = findFuzzyValue(rawData, ['mahsulot', 'product', 'tovar', 'item', 'buyum', 'xizmat', 'kurs']);
  const defaultProductName = (pageName !== "Webhook" && pageName !== "Make.com" && pageName !== "Yuboraman.uz") ? pageName : formId;
  const productName = extractProductName(productNameFromPayload || defaultProductName);

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
    phone: chosenPhone ? String(chosenPhone).trim() : null,
    cleanPhone: cleanPhone,
    phone2: chosenPhone2 ? String(chosenPhone2).trim() : null,
    cleanPhone2: cleanPhone2,
    formId: String(formId).trim().substring(0, 200),
    pageName: String(pageName).trim().substring(0, 200),
    productName: String(productName).trim().substring(0, 200),
    leadId: leadId ? String(leadId).trim() : null,
    city: city ? String(city).trim() : null,
    notes: cleanLeadNotes(additionalNotes.join('\n'))
  };
}

/**
 * Telegram Bot API'ga xabar yuborish (exponential backoff retry bilan).
 */
async function sendTelegramNotificationWithRetry(leadData, dealId) {
  // Foydalanuvchi talabiga ko'ra CRM Telegram boti orqali xabar yuborish vaqtincha o'chirib qo'yilgan
  console.log('[Telegram Notification] CRM Telegram boti yuborish to\'xtatilgan (skip).');
  return;
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
    const randomDigits = Math.floor(1000000 + Math.random() * 9000000);
    parsed.phone = `+99899${randomDigits}`;
    
    if (parsed.name.toLowerCase().includes('test lead') || parsed.name === "Noma'lum") {
      parsed.name = `Test Lead (Yuboraman)`;
    }
  }

  // 2. Validatsiya & Spam-Leadlarni butunlay to'sish
  const isNameUnknown = !parsed.name || parsed.name.trim() === "" || parsed.name.trim() === "Noma'lum" || parsed.name.trim() === "Noma'lum Mijoz";
  const isPhoneEmpty = (!parsed.phone || parsed.phone.trim() === "" || parsed.phone.trim().toLowerCase() === "noma'lum" || parsed.phone.trim().toLowerCase() === "undefined") &&
                       (!parsed.phone2 || parsed.phone2.trim() === "" || parsed.phone2.trim().toLowerCase() === "noma'lum" || parsed.phone2.trim().toLowerCase() === "undefined");
  
  if (isNameUnknown && isPhoneEmpty) {
    console.warn(`[Universal Lead Blocked] Spam/bo'sh lead rad etildi (ism va telefon bo'sh). RawData:`, JSON.stringify(rawData));
    const err = new Error("Spam/bo'sh so'rov. Telefon va ism bo'sh bo'lganligi sababli rad etildi.");
    err.statusCode = 400;
    throw err;
  }

  if (!parsed.name || parsed.name.trim() === "Noma'lum") {
    parsed.name = "Noma'lum Mijoz";
  }

  // Telefon normalizatsiyasi (Fail-safe)
  let cleanPhone = null;
  if (parsed.phone && parsed.phone.trim() !== '') {
    try {
      cleanPhone = normalizeUniversalPhone(parsed.phone);
    } catch (phoneErr) {
      console.warn(`[Universal Lead Fail-safe] Telefon 1 ni normalizatsiya qilishda ogohlantirish: ${phoneErr.message}`);
      parsed.notes = `[Yaroqsiz Telefon 1: ${parsed.phone}]\n${parsed.notes || ''}`;
      cleanPhone = null;
    }
  }

  let cleanPhone2 = null;
  if (parsed.phone2 && parsed.phone2.trim() !== '') {
    try {
      cleanPhone2 = normalizeUniversalPhone(parsed.phone2);
    } catch (phoneErr2) {
      console.warn(`[Universal Lead Fail-safe] Telefon 2 ni normalizatsiya qilishda ogohlantirish: ${phoneErr2.message}`);
      parsed.notes = `[Yaroqsiz Telefon 2: ${parsed.phone2}]\n${parsed.notes || ''}`;
      cleanPhone2 = null;
    }
  }

  if (!cleanPhone && !cleanPhone2) {
    parsed.notes = `[Telefon raqami kiritilmagan]\n${parsed.notes || ''}`;
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

  // 3b. Vaqt oynasi bo'yicha dublikat tekshiruvi (Oxirgi 5 daqiqa ichida bir xil telefon, ism yoki mahsulot)
  let duplicateRecentDeal = null;
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

  const phoneSearchFilters = [];
  if (cleanPhone) {
    phoneSearchFilters.push({ phone: cleanPhone });
    phoneSearchFilters.push({ phone2: cleanPhone });
  }
  if (cleanPhone2) {
    phoneSearchFilters.push({ phone: cleanPhone2 });
    phoneSearchFilters.push({ phone2: cleanPhone2 });
  }

  if (phoneSearchFilters.length > 0) {
    const matchingClient = await prisma.client.findFirst({
      where: { OR: phoneSearchFilters }
    });
    if (matchingClient) {
      duplicateRecentDeal = await prisma.deal.findFirst({
        where: {
          clientId: matchingClient.id,
          createdAt: { gte: fiveMinutesAgo }
        }
      });
    }
  }

  // Fallback: ism va mahsulot nomi bo'yicha
  if (!duplicateRecentDeal && parsed.name && parsed.name !== "Noma'lum Mijoz") {
    duplicateRecentDeal = await prisma.deal.findFirst({
      where: {
        client: {
          name: parsed.name
        },
        OR: [
          { productName: parsed.productName },
          { productName: parsed.formId }
        ],
        createdAt: { gte: fiveMinutesAgo }
      }
    });
  }

  if (duplicateRecentDeal) {
    console.warn(`[Universal Lead Duplicate] Oxirgi 5 daqiqa ichida ayni shu mijoz/murojaatdan lead kelgan.`);
    const err = new Error('Dublikat so\'rov: Oxirgi 5 daqiqa ichida ayni shu mijozdan murojaat kelgan.');
    err.statusCode = 409;
    err.duplicateDealId = duplicateRecentDeal.id;
    throw err;
  }

  // 4. Tranzaksiya: Client va Deal yozuvlarini yaratish/topish
  const executeWebhookLeadTx = async () => {
    return await prisma.$transaction(async (tx) => {
      // Mijozni qidiramiz (phone yoki phone2 bo'yicha)
      let client = null;
      const clientSearchOr = [];
      if (cleanPhone) {
        clientSearchOr.push({ phone: { contains: cleanPhone } });
        clientSearchOr.push({ phone2: { contains: cleanPhone } });
      }
      if (cleanPhone2) {
        clientSearchOr.push({ phone: { contains: cleanPhone2 } });
        clientSearchOr.push({ phone2: { contains: cleanPhone2 } });
      }

      if (clientSearchOr.length > 0) {
        client = await tx.client.findFirst({
          where: { OR: clientSearchOr }
        });
      }

      if (!client) {
        client = await tx.client.create({
          data: {
            name: parsed.name,
            phone: cleanPhone || parsed.phone || null,
            phone2: cleanPhone2 || parsed.phone2 || null,
            city: parsed.city || null,
            notes: `Manba: ${parsed.pageName} (Universal Webhook)`
          }
        });
        console.log(`[Universal Lead Transaction] Yangi mijoz yaratildi. ID: ${client.id}, Tel1: ${cleanPhone}, Tel2: ${cleanPhone2}`);
      } else {
        const clientUpdates = {};
        if (parsed.city && !client.city) clientUpdates.city = parsed.city;
        if (cleanPhone2 && !client.phone2 && client.phone !== cleanPhone2) clientUpdates.phone2 = cleanPhone2;
        if (cleanPhone && !client.phone && client.phone2 !== cleanPhone) clientUpdates.phone = cleanPhone;

        if (Object.keys(clientUpdates).length > 0) {
          client = await tx.client.update({
            where: { id: client.id },
            data: clientUpdates
          });
        }
        console.log(`[Universal Lead Transaction] Mavjud mijoz topildi/yangilandi. ID: ${client.id}`);
      }

      // ALSO upsert Contact
      let contact = null;
      if (clientSearchOr.length > 0) {
        contact = await tx.contact.findFirst({
          where: { OR: clientSearchOr }
        });
      }

      if (!contact) {
        const cName = parsed.name.trim();
        const nameParts = cName.split(/\s+/);
        const firstName = nameParts[0] || "Nomsiz";
        const lastName = nameParts.slice(1).join(' ') || null;

        contact = await tx.contact.create({
          data: {
            firstName,
            lastName,
            phone: cleanPhone || parsed.phone || null,
            phone2: cleanPhone2 || parsed.phone2 || null,
            city: parsed.city || null
          }
        });
        console.log(`[Universal Lead Transaction] Yangi kontakt yaratildi. ID: ${contact.id}`);
      } else {
        const contactUpdates = {};
        if (parsed.city && !contact.city) contactUpdates.city = parsed.city;
        if (cleanPhone2 && !contact.phone2 && contact.phone !== cleanPhone2) contactUpdates.phone2 = cleanPhone2;
        if (cleanPhone && !contact.phone && contact.phone2 !== cleanPhone) contactUpdates.phone = cleanPhone;

        if (Object.keys(contactUpdates).length > 0) {
          contact = await tx.contact.update({
            where: { id: contact.id },
            data: contactUpdates
          });
        }
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
      const rawNotes = cleanLeadNotes(parsed.notes);
      const targetProductName = parsed.productName || parsed.formId || 'Universal Lead';

      const previousDealCount = await tx.deal.count({
        where: { clientId: client.id }
      });
      const isRepeatedLead = previousDealCount > 0;

      let finalNotes = isRepeatedLead
        ? (rawNotes ? `[⚠️ Takroriy murojaat]\n${rawNotes}` : `[⚠️ Takroriy murojaat]`)
        : rawNotes;

      if (!cleanPhone && !cleanPhone2 && (parsed.phone || parsed.phone2)) {
        const warning = `[⚠️ Telefon raqami tekshirish talab etiladi: ${parsed.phone || parsed.phone2}]`;
        finalNotes = finalNotes ? `${warning}\n${finalNotes}` : warning;
      }

      const deal = await tx.deal.create({
        data: {
          productName: targetProductName,
          amount: 0,
          status: 'new',
          clientId: client.id,
          contactId: contact ? contact.id : null,
          pipelineId: targetPipelineId,
          stageId: targetStageId,
          notes: finalNotes,
          source: (function() {
            let resolvedSource = 'target';
            const rawSourceField = String(rawData.source || rawData.Source || rawData.source_type || rawData.manba || parsed.pageName || '').toLowerCase();
            if (rawSourceField.includes('instagram') || rawSourceField.includes('insta') || rawSourceField.includes('ig')) {
              resolvedSource = 'instagram';
            } else if (rawSourceField.includes('telegram') || rawSourceField.includes('tg')) {
              resolvedSource = 'telegram';
            } else if (rawSourceField.includes('target') || rawSourceField.includes('fb') || rawSourceField.includes('facebook') || rawSourceField.includes('ads')) {
              resolvedSource = 'target';
            } else if (rawSourceField.includes('oddiy') || rawSourceField.includes('manual')) {
              resolvedSource = 'oddiy';
            }
            return resolvedSource;
          })()
        }
      });
      console.log(`[Universal Lead Transaction] Sdelka yaratildi. ID: ${deal.id} ${isRepeatedLead ? '(⚠️ Takroriy lead)' : ''}`);

      // ActivityLog
      await tx.activityLog.create({
        data: {
          action: isRepeatedLead ? '⚠️ Takroriy sdelka yaratildi' : 'Sdelka yaratildi',
          details: isRepeatedLead
            ? `Universal Webhook (${source}) orqali takroriy sdelka yaratildi (Mijozning ${previousDealCount + 1}-murojaati)`
            : `Universal Webhook (${source}) orqali sdelka yaratildi (Lead ID: ${parsed.leadId || 'N/A'}, Tel1: ${cleanPhone || 'yo\'q'}, Tel2: ${cleanPhone2 || 'yo\'q'})`,
          dealId: deal.id
        }
      });

      return { client, deal };
    }, { timeout: 15000 });
  };

  let result;
  try {
    result = await executeWebhookLeadTx();
  } catch (dbErr) {
    if (dbErr.message && (dbErr.message.includes('Unique constraint') || dbErr.code === 'P2002')) {
      console.warn('[Universal Lead DB Transaction] Sekvensiya (ID) ziddiyati aniqlandi. Sekvensiyalarni tiklab qayta urinilmoqda...');
      try {
        await fixPostgresSequences(prisma);
        result = await executeWebhookLeadTx();
      } catch (retryErr) {
        console.error('[Universal Lead DB Transaction Retry Error] Qayta urinishda ham xato:', retryErr.message);
        const err = new Error(`Ma'lumotlar bazasida xatolik: ${retryErr.message}`);
        err.statusCode = 500;
        throw err;
      }
    } else {
      console.error('[Universal Lead DB Transaction Error] Bazaga saqlashda xato:', dbErr.message);
      const err = new Error(`Ma'lumotlar bazasida xatolik: ${dbErr.message}`);
      err.statusCode = 500;
      throw err;
    }
  }

  // 5. Asinxron Telegram xabarini yuborish (Faqat sdelka yaratilgan bo'lsa)
  if (result.deal) {
    sendTelegramNotificationWithRetry({
      name: parsed.name,
      phone: cleanPhone,
      formId: parsed.formId,
      pageName: parsed.pageName,
      leadId: parsed.leadId
    }, result.deal.id).catch(tgErr => {
      console.error('[Universal Lead Telegram Outer Error] Telegram zanjiridan kutilmagan xato:', tgErr.message);
    });

    // 5b. Web Push Notification to Admins & Managers
    sendPushToRole('admin', {
      title: '🆕 Yangi Lead Tushdi!',
      body: `${parsed.name || 'Mijoz'} (${cleanPhone}) — ${parsed.productName || 'Yangi lead'}`,
      url: `/deals?dealId=${result.deal.id}`
    }).catch(() => {});

    // 6. Real-time UI yangilanish (WebSocket)
    if (broadcast) {
      try {
        const fullDeal = await prisma.deal.findUnique({
          where: { id: result.deal.id },
          include: {
            client: { select: { id: true, name: true, company: true, phone: true, phone2: true, city: true } },
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
  } else {
    console.log(`[Universal Lead] Telefon raqamsiz lead. Telegram va WebSocket bildirishnomalari yuborilmadi.`);
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
  handleUniversalLead,
  extractAllPhones,
  extractBestPhone
};
