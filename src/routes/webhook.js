const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const supabase = require('../config/supabase');
const prisma = require('../config/database');
const leadService = require('../services/leadService');
const { webhookIPWhitelist, rateLimiter } = require('../middleware/security');
const { logAudit, getAuditContext } = require('../middleware/auditLog');

/**
 * Meta (Facebook/Instagram) X-Hub-Signature-256 xavfsizlik imzosini tekshirish middleware.
 * Bu so'rov aynan Meta platformasidan kelayotganini kafolatlaydi.
 */
function verifyWebhookToken(req, res, next) {
  // GET so'rovi (tasdiqlash) uchun xavfsizlik tekshiruvini o'tkazib yuboramiz
  if (req.method === 'GET') return next();

  console.log(`[Signature Check] POST so'rov keldi. URL: ${req.originalUrl}`);

  const signature = req.headers['x-hub-signature-256'];
  const appSecret = process.env.APP_SECRET;

  // Agar server muhitida APP_SECRET o'rnatilmagan bo'lsa, tekshiruvni chetlab o'tamiz (faqat dev/test uchun)
  if (!appSecret) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[Meta Webhook Secure] APP_SECRET o\'rnatilmagan — signature tekshiruvi majburiy.');
      return res.status(500).json({ error: 'Internal configuration error: APP_SECRET is missing.' });
    }
    console.warn('[Signature Check] APP_SECRET o\'rnatilmagan — signature tekshiruvi o\'tkavib yuborildi.');
    return next();
  }

  if (!signature) {
    console.error('[Meta Webhook Secure] Signature xabari headerlarda topilmadi.');
    return res.status(401).json({ error: 'Signature is missing.' });
  }

  try {
    const elements = signature.split('=');
    const signatureHash = elements[1];
    
    // rawBody ni crypto yordamida appSecret orqali hashlaymiz
    const expectedHash = crypto
      .createHmac('sha256', appSecret)
      .update(req.rawBody || '')
      .digest('hex');

    const sigBuffer = Buffer.from(signatureHash || '', 'hex');
    const expectedBuffer = Buffer.from(expectedHash, 'hex');

    if (
      sigBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(sigBuffer, expectedBuffer)
    ) {
      console.error('[Meta Webhook Secure] Signature mos kelmadi (Signature Mismatch).');
      return res.status(401).json({ error: 'Signature mismatch.' });
    }

    next();
  } catch (error) {
    console.error('[Meta Webhook Secure] Imzoni tekshirishda xatolik:', error.message);
    return res.status(500).json({ error: 'Internal signature verification error.' });
  }
}

// Xavfsizlik Middleware: Tokenni tekshirish (Make/Zapier webhook uchun - Vaqtincha ochiq)
const verifyMakeToken = (req, res, next) => {
  const headerToken = req.header('X-CRM-Webhook-Token') || req.header('X-Yuboraman-Token');
  const queryToken = req.query.token;
  const paramToken = req.params.token;

  const token = headerToken || queryToken || paramToken;
  const secret = process.env.WEBHOOK_SECRET_TOKEN || 'desco-crm-secret-2026';

  if (!token) {
    console.warn(`[Webhook Secure Warning] Token yuborilmadi. Ammo integratsiya muammosiz ishlashi uchun so'rov qabul qilindi.`);
    return next();
  }

  if (token !== secret) {
    console.warn(`[Webhook Secure Warning] Noto'g'ri token yuborildi: "${token}". Ammo so'rov qabul qilindi.`);
    return next();
  }
  next();
};

// Xavfsizlik Middleware: Tokenni tekshirish (Yuboraman webhook uchun - Vaqtincha ochiq)
const verifyYuboramanToken = (req, res, next) => {
  const headerToken = req.header('X-Yuboraman-Token') || req.header('X-CRM-Webhook-Token');
  const queryToken = req.query.token;
  const paramToken = req.params.token;

  const token = headerToken || queryToken || paramToken;
  const secret = process.env.YUBORAMAN_SECRET_TOKEN || 'yuboraman-secret-2026';

  if (!token) {
    console.warn(`[Yuboraman Webhook Warning] Token yuborilmadi. Ammo integratsiya muammosiz ishlashi uchun so'rov qabul qilindi.`);
    return next();
  }

  if (token !== secret) {
    console.warn(`[Yuboraman Webhook Warning] Noto'g'ri token yuborildi: "${token}". Ammo so'rov qabul qilindi.`);
    return next();
  }
  next();
};

// POST /api/webhook/lead (Make/Zapier uchun)
router.post('/lead/:token?', verifyMakeToken, async (req, res, next) => {
  const startTime = Date.now();
  try {
    const broadcast = req.app.get('broadcast');
    
    // Universal lead handler
    const result = await leadService.handleUniversalLead('make', req.body, broadcast);
    
    // Test lead (dry run) bo'lsa, 200 OK qaytaramiz va audit logni chetlab o'tamiz
    if (result.isTest) {
      console.log('[Make Webhook] Test lead muvaffaqiyatli aniqlandi (Dry run).');
      return res.status(200).json({
        success: true,
        message: 'Test lead processed successfully (dry run)',
        isTest: true
      });
    }

    // Audit Log
    try {
      logAudit(
        'LEAD_RECEIVED_MAKE',
        `Client ID: ${result.client.id}, Deal ID: ${result.deal.id}, Form: ${result.deal.productName}`,
        null, null,
        req.ip || ''
      );
    } catch (auditErr) {
      console.warn('[Make Webhook Warn] Audit log yozishda xato:', auditErr.message);
    }

    return res.status(201).json({
      message: 'Lead muvaffaqiyatli qabul qilindi va sdelkaga aylantirildi',
      dealId: result.deal.id,
      clientId: result.client.id
    });

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[Make Webhook POST Error] Duration: ${duration}ms. Error:`, error.message);
    
    const status = error.statusCode || 500;
    if (status === 409) {
      return res.status(409).json({ error: error.message, status: 'duplicate' });
    }
    return res.status(status).json({ error: error.message || 'Internal Server Error' });
  }
});

// POST /api/webhook/yuboraman (Yuboraman.uz uchun universal lead qabul qilish)
router.post('/yuboraman/:token?', verifyYuboramanToken, async (req, res) => {
  const startTime = Date.now();
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`[Yuboraman Webhook POST] So'rov keldi! Vaqt: ${new Date().toISOString()}`);
  console.log(`[Yuboraman Webhook POST] Body:`, JSON.stringify(req.body));
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  try {
    const broadcast = req.app.get('broadcast');
    
    // Asosiy lead ishlash xizmatini chaqiramiz
    const result = await leadService.handleUniversalLead('yuboraman', req.body, broadcast);
    
    // Test lead (dry run) bo'lsa, 200 OK qaytaramiz va audit logni chetlab o'tamiz
    if (result.isTest) {
      console.log('[Yuboraman Webhook] Test lead muvaffaqiyatli aniqlandi (Dry run).');
      return res.status(200).json({
        success: true,
        message: 'Test lead processed successfully (dry run)',
        isTest: true
      });
    }

    // Audit log
    try {
      logAudit(
        'LEAD_RECEIVED_YUBORAMAN',
        `Client ID: ${result.client.id}, Deal ID: ${result.deal.id}, Form: ${result.deal.productName}`,
        null, null,
        req.ip || ''
      );
    } catch (auditErr) {
      console.warn('[Yuboraman Webhook Warn] Audit log yozishda xato:', auditErr.message);
    }

    const duration = Date.now() - startTime;
    console.log(`[Yuboraman Webhook POST Success] Muvaffaqiyatli yakunlandi. Deal ID: ${result.deal.id}. Duration: ${duration}ms`);

    return res.status(200).json({
      success: true,
      message: 'Lead muvaffaqiyatli qabul qilindi',
      dealId: result.deal.id,
      clientId: result.client.id
    });

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[Yuboraman Webhook POST Error] Xatolik yuz berdi. Duration: ${duration}ms. Error:`, error.message);

    // Xato turiga qarab javob qaytaramiz
    const status = error.statusCode || 500;
    
    if (status === 409) {
      // Dublikat lead bo'lsa, 409 Conflict qaytaramiz
      return res.status(409).json({
        success: false,
        status: 'duplicate',
        message: error.message,
        duplicateDealId: error.duplicateDealId
      });
    }

    return res.status(status).json({
      success: false,
      error: error.message || 'Internal Server Error'
    });
  }
});

// ==========================================
// TO'G'RIDAN-TO'G'RI META (FACEBOOK/INSTAGRAM) INTEGRATSIYASI
// ==========================================

// 1-QADAM: Meta Webhook tasdiqlash (Verification)
router.get('/', (req, res) => {
  const verify_token = process.env.VERIFY_TOKEN || process.env.WEBHOOK_VERIFY_TOKEN || 'desco-secret-token-123';

  const mode = req.query['hub.mode'] || (req.query.hub && req.query.hub.mode);
  const token = req.query['hub.verify_token'] || (req.query.hub && req.query.hub.verify_token);
  const challenge = req.query['hub.challenge'] || (req.query.hub && req.query.hub.challenge);

  if (mode && token) {
    if (mode === 'subscribe' && token === verify_token) {
      console.log('META WEBHOOK VERIFIED!');
      res.status(200).send(challenge); // Meta faqatgina toza matn formatidagi challenge raqamini kutadi
    } else {
      res.sendStatus(403);
    }
  } else {
    res.status(400).send('Bad Request');
  }
});

// 2-QADAM: Meta'dan Lead qabul qilish (POST)
// Xavfsizlik qatlamlari: IP Whitelist → Rate Limit → Signature Verification
router.post('/', webhookIPWhitelist, rateLimiter(100, 60000), verifyWebhookToken, async (req, res) => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`[Webhook POST] So'rov keldi! Vaqt: ${new Date().toISOString()}`);
  console.log(`[Webhook POST] Body object: ${req.body?.object}, entry soni: ${req.body?.entry?.length || 0}`);
  console.log(`[Webhook POST] Headers: content-type=${req.headers['content-type']}, x-hub-signature=${req.headers['x-hub-signature-256'] ? 'MAVJUD' : 'YO\'Q'}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Meta'ga bloklanib qolmaslik uchun darhol 200 OK qaytaramiz
  res.status(200).send('EVENT_RECEIVED');

  try {
    // Audit log: webhook kelishi
    const firstEntry = req.body?.entry?.[0];
    const firstChange = firstEntry?.changes?.[0];
    logAudit(
      'WEBHOOK_RECEIVED',
      `page_id: ${firstEntry?.id || 'unknown'}, leadgen_id: ${firstChange?.value?.leadgen_id || 'unknown'}`,
      null, null,
      req.ip || ''
    );

    const broadcast = req.app.get('broadcast');
    await leadService.handleMetaWebhook(req.body, broadcast);
  } catch (error) {
    console.error('[Meta Webhook Router Error] Asinxron ishga tushirishda xato:', error);
  }
});

// ==========================================
// TELEGRAM BOT WEBHOOK INTEGRATION
// ==========================================

/**
 * Kelgan xabar matnidan lead ma'lumotlarini ajratib olish (parsing).
 * Ism, telefon va mahsulot nomlarini regex va line-by-line moslashuvchan usulda topadi.
 */
/**
 * O'zbekiston telefon raqamini normalizatsiya qiladi.
 * Barcha bo'shliq, tire, qavs va nuqtalarni olib tashlaydi va standard formatga keltiradi (+998XXXXXXXXX).
 * @param {string} raw - Xom telefon raqami
 * @returns {string|null} Normalizatsiya qilingan raqam yoki null
 */
/**
 * Matndan haqiqiy shahar nomini ajratadi.
 * Narx qiziqtirgan yoki boshqa savollarni shahar deb hisoblamaydi.
 */
function extractCity(value) {
  if (!value) return null;
  const val = value.trim().toLowerCase();
  
  // Shahar bo'lmagan kalit so'zlar (savollar, narx, yetkazib berish va h.k. - lotin va kirill alifbosida)
  const nonCityKeywords = [
    'narx', 'qancha', 'nech', 'pul', 'skidka', 'aksiya', 'salom', 'assalom', 
    'kurs', 'buyurtma', 'dostavka', 'yetkaz', 'ok', 'xo‘p', 'xop', 'ha ', 'yoq', 'yo‘q',
    'нарх', 'канча', 'қанча', 'неч', 'пул', 'скидка', 'акция', 'салом', 'ассалом',
    'курс', 'буюртма', 'доставка', 'етказиб', 'етказиш', 'ҳа', 'йўқ'
  ];
  
  // Agar juda uzun bo'lsa yoki savol belgisi bo'lsa yoki shahar bo'lmagan kalit so'zlar qatnashsa, saqlamaymiz
  if (value.length > 30 || val.includes('?') || nonCityKeywords.some(kw => val.includes(kw))) {
    return null;
  }
  
  return value.trim();
}

/**
 * Kelgan xabar matnidan lead ma'lumotlarini ajratib olish (parsing).
 * Yuboraman.Uz va har qanday boshqa telegram bot/kanal xabarlarini to'liq universal, fuzzy va professional tarzda parse qiladi.
 */
function parseTelegramMessage(text) {
  if (!text) {
    return { name: null, phone: null, product: null, city: null, notes: null, isYuboramanFormat: false };
  }

  const textTrimmed = text.trim();
  const isYuboraman = textTrimmed.includes("📝 Ma'lumotlar:") || textTrimmed.includes("Telegram uchun tayyor") || textTrimmed.includes("📄 Nomi:");

  // Emojilar va boshqa markerlarni tozalab qatorlarga ajratamiz
  const lines = textTrimmed.split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);

  const details = {};
  let keyValFound = false;

  for (const line of lines) {
    // Qatorni boshidagi ro'yxat tartib raqamlari yoki emojilardan tozalaymiz
    const cleanLine = line.replace(/^[\s\d.*•●○▪▪-]+\.?\s*/, '')
                          .replace(/^[^\w\sа-яА-ЯўўқҳғўЎҚҲҒ:=-]+/u, '')
                          .trim();

    const match = cleanLine.match(/^([^:=-]+)[:=-]\s*(.+)$/);
    if (match) {
      const key = match[1].trim().toLowerCase();
      const val = match[2].trim();
      if (key && val) {
        details[key] = val;
        keyValFound = true;
      }
    }
  }

  let name = null;
  let phone = null;
  let product = null;
  let city = null;

  // Agar kalit-qiymat tuzilishi topilgan bo'lsa, fuzzy qidiruv orqali maydonlarni ajratamiz
  if (keyValFound) {
    name = leadService.findFuzzyValue(details, ['full_name', 'first_name', 'name', 'ism', 'user', 'client', 'mijoz', 'fio', 'f.i.o', 'buyurtmachi', 'customer', 'username'], ['campaign', 'product', 'form', 'ad', 'source', 'page', 'site', 'id']);
    phone = leadService.findFuzzyValue(details, ['phone_number', 'phone', 'telefon_raqami', 'telefon', 'tel', 'raqam', 'number', 'nomer', 'aloqa', 'contact'], ['form', 'ad', 'id', 'page', 'campaign']);
    product = leadService.findFuzzyValue(details, ['product_name', 'product', 'mahsulot', 'tovar', 'kurs', 'tarif', 'buyurtma', 'nomi', 'campaign_name', 'campaign', 'forma_nomi', 'form_name', 'form_id']);
    city = leadService.findFuzzyValue(details, ['city', 'shahar', 'manzil', 'hudud', 'address', 'viloyat', 'rayon', 'qayerga', 'location'], ['campaign', 'product', 'form', 'ad', 'id']);
  }

  // Raqamlar uchun fallback: matn ichidan telefon raqami formatiga mos keladigan birinchi qiymatni qidiramiz
  if (!phone) {
    // 9 va 12 xonali telefon formatlariga mos tushadigan, ammo 14+ xonali Lead/Ad ID-larni chetlab o'tadigan regex
    const phoneRegex = /(?:\+?998\s*\(?\d{2}\)?\s*\d{3}[\s.-]*\d{2}[\s.-]*\d{2})|(?:\b998\d{9}\b)|(?:\b\d{2}\s*\(?\d{2}\)?\s*\d{3}[\s.-]*\d{2}[\s.-]*\d{2}\b)|(?:\b8\s*\(?\d{2}\)?\s*\d{3}[\s.-]*\d{2}[\s.-]*\d{2}\b)|(?:\b\d{9}\b)/g;
    const matches = text.match(phoneRegex);
    if (matches && matches.length > 0) {
      for (const m of matches) {
        const cleanDigitLength = m.replace(/\D/g, '').length;
        if (cleanDigitLength >= 9 && cleanDigitLength <= 13) {
          phone = m.trim();
          break;
        }
      }
    }
  }

  // Ism uchun fallback: telefon raqami yoki mahsulot so'zlari ishtirok etmagan normal uzunlikdagi qatorni ism deb olamiz
  if (!name) {
    for (const line of lines) {
      const cleanLine = line.replace(/^[\s\d.*•●○▪▪-]+\.?\s*/, '').trim();
      const hasLongDigits = /\d{6,}/.test(cleanLine);
      const isHeaderOrFooter = cleanLine.includes("Ma'lumotlar") || cleanLine.includes("tayyor") || cleanLine.startsWith("📄") || cleanLine.startsWith("ℹ️") || cleanLine.startsWith("📅");
      const hasProductIndicator = cleanLine.toLowerCase().includes("mahsulot") || cleanLine.toLowerCase().includes("product") || cleanLine.toLowerCase().includes("buyurtma");
      
      if (!hasLongDigits && !isHeaderOrFooter && !hasProductIndicator && cleanLine.length > 2 && cleanLine.length < 50) {
        name = cleanLine;
        break;
      }
    }
  }

  // Mahsulot uchun fallback:
  if (!product) {
    for (const line of lines) {
      const cleanLine = line.replace(/^[\s\d.*•●○▪▪-]+\.?\s*/, '').trim();
      const isHeaderOrFooter = cleanLine.includes("Ma'lumotlar") || cleanLine.includes("tayyor") || cleanLine.startsWith("ℹ️") || cleanLine.startsWith("📅");
      if (isHeaderOrFooter || cleanLine === name || cleanLine === phone) continue;
      
      if (cleanLine.toLowerCase().includes("mahsulot") || cleanLine.toLowerCase().includes("product") || cleanLine.toLowerCase().includes("tovar") || cleanLine.toLowerCase().includes("nomi:")) {
        product = cleanLine.replace(/^[^:]+:\s*/, '').trim();
        break;
      }
    }
  }


  // Default qiymatlar
  if (!name || name === "Noma'lum") name = "Noma'lum Mijoz";
  if (!product) product = isYuboraman ? "Yuboraman Lead" : "Telegram Lead";
  
  // Mahsulot nomini tozalash (rek 2 | 2.07 | Oyoq massajor (2) -> Oyoq massajor (2))
  function cleanProductName(pName) {
    if (!pName) return pName;
    const parts = pName.split('|').map(p => p.trim());
    if (parts.length > 1) {
      if (/^rek\s*\d+/i.test(parts[0]) && parts.length >= 3) {
        return parts[2];
      }
      return parts[0];
    }
    return pName;
  }
  product = cleanProductName(product);
  
  if (city) {
    city = extractCity(city);
  }

  // Izohdan (notes) operatorga kerak bo'lmagan texnik va takroriy maydonlarni tozalaymiz
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

  // Izoh (Notes) shakllantirish
  let notes = "";
  if (isYuboraman) {
    const nomiLine = lines.find(l => l.includes("Nomi:"));
    const manbaLine = lines.find(l => l.includes("Manba:"));
    const sanaLine = lines.find(l => l.includes("Sana:"));
    
    const notesArray = [];
    if (nomiLine) notesArray.push(nomiLine.trim());
    if (manbaLine) notesArray.push(manbaLine.trim());
    if (sanaLine) notesArray.push(sanaLine.trim());
    notesArray.push("--- Tafsilotlar ---");
    for (const [key, val] of Object.entries(details)) {
      if (!isTechnicalField(key) && val !== undefined && val !== null && String(val).trim() !== '') {
        notesArray.push(`${key}: ${val}`);
      }
    }
    notes = notesArray.join('\n');
  } else {
    notes = `Integratsiya usuli: telegram\nOriginal Xabar:\n${text}`;
  }

  return {
    name,
    phone: phone || "Noma'lum",
    product,
    city: city || null,
    notes,
    source: details['manba'] || details['source'] || "telegram",
    isYuboramanFormat: isYuboraman
  };
}

// Telegram Secret Token verification middleware
function verifyTelegramSecret(req, res, next) {
  const secretToken = req.headers['x-telegram-bot-api-secret-token'] || req.query.token;
  const expectedToken = process.env.TELEGRAM_WEBHOOK_SECRET;

  if (!expectedToken) {
    console.warn('[Telegram Webhook] TELEGRAM_WEBHOOK_SECRET .env faylida belgilanmagan. Tekshiruv o\'tkazib yuborildi.');
    return next();
  }

  if (secretToken !== expectedToken) {
    console.error(`[Telegram Webhook] Xavfsizlik xatosi: Token mos kelmadi. Kelgan token: ${secretToken || 'topilmadi'}`);
    return res.status(401).json({ error: 'Unauthorized: Secret token mismatch.' });
  }

  next();
}

// POST /api/webhooks/telegram - Telegram webhook lead qabul qiluvchi route
router.post('/telegram', verifyTelegramSecret, async (req, res) => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`[Telegram Webhook POST] So'rov keldi! Vaqt: ${new Date().toISOString()}`);
  console.log(`[Telegram Webhook POST] Update ID: ${req.body?.update_id}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  try {
    const update = req.body;
    const message = update?.message;

    if (!message) {
      console.log('[Telegram Webhook] Update tarkibida "message" obyekti topilmadi, o\'tkazib yuboriladi.');
      return res.status(200).json({ status: 'ignored', message: 'No message object found' });
    }

    const text = message.text;
    const fromUser = message.from;
    const chatId = message.chat?.id;

    if (!text) {
      console.log('[Telegram Webhook] Xabar matni bo\'sh, o\'tkazib yuboriladi.');
      return res.status(200).json({ status: 'ignored', message: 'No text message' });
    }

    // 1. Matndan lead ma'lumotlarini parse qilamiz
    const parsed = parseTelegramMessage(text);
    console.log(`[Telegram Webhook Parse] Natija: Ism="${parsed.name}", Tel="${parsed.phone}", Mahsulot="${parsed.product}"`);

    let cleanPhone = null;
    if (parsed.phone && parsed.phone.trim() !== "Noma'lum") {
      try {
        cleanPhone = leadService.normalizeUniversalPhone(parsed.phone);
      } catch (phoneErr) {
        console.warn(`[Telegram Webhook Fail-safe] Telefon normalizatsiyasida ogohlantirish: ${phoneErr.message}`);
        parsed.notes = `[Yaroqsiz Telefon: ${parsed.phone}]\n${parsed.notes}`;
        cleanPhone = null;
      }
    }

    // 2. Client va Deal yaratishni tranzaksiyaga olamiz (Direct Prisma Transaction, latency uchun 15s)
    const { client, deal } = await prisma.$transaction(async (tx) => {
      let currentClient = null;
      if (cleanPhone) {
        currentClient = await tx.client.findFirst({
          where: { phone: { contains: cleanPhone } }
        });
      }

      // Build client notes dynamically
      const clientNotesParts = [];
      if (parsed.source && parsed.source !== 'telegram') {
        clientNotesParts.push(`Manba: ${parsed.source}`);
      }
      clientNotesParts.push(`Integratsiya usuli: telegram`);
      clientNotesParts.push(`Telegram Chat ID: ${chatId || 'Noma\'lum'}`);
      clientNotesParts.push(`Username: ${fromUser?.username ? '@' + fromUser.username : 'Noma\'lum'}`);
      const clientNotes = clientNotesParts.join('\n');

      if (!currentClient) {
        currentClient = await tx.client.create({
          data: {
            name: parsed.name || "Noma'lum",
            phone: cleanPhone || null,
            city: parsed.city || null,
            notes: clientNotes
          }
        });
      } else {
        // Agar yangi shahar nomi parse qilingan bo'lsa va mijozda shahar bo'lmasa, uni yangilaymiz
        if (parsed.city && !currentClient.city) {
          currentClient = await tx.client.update({
            where: { id: currentClient.id },
            data: { city: parsed.city }
          });
        }
      }

      // 3. Voronka va Bosqichni topish
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

      // 4. Sdelka (Deal) yaratish using Prisma
      const dealNotes = parsed.isYuboramanFormat
        ? parsed.notes
        : `Integratsiya usuli: telegram\nOriginal Xabar:\n${text}`;

      const newDeal = await tx.deal.create({
        data: {
          productName: parsed.product || 'Telegram orqali Lead',
          amount: 0,
          status: 'new',
          clientId: currentClient.id,
          pipelineId: targetPipelineId,
          stageId: targetStageId,
          notes: dealNotes
        }
      });

      return { client: currentClient, deal: newDeal };
    }, { timeout: 15000 });

    console.log(`[Telegram Webhook] ✓ Yangi sdelka (Deal) muvaffaqiyatli yaratildi. ID: ${deal.id}`);

    // UI real-vaqtda yangilanishi uchun socket signalini yuboramiz
    const broadcast = req.app.get('broadcast');
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
    }

    res.status(200).json({
      success: true,
      message: 'Telegram lead muvaffaqiyatli sdelkaga aylantirildi',
      dealId: deal.id,
      clientId: client.id,
      client: {
        id: client.id,
        name: client.name,
        phone: client.phone,
        city: client.city,
        notes: client.notes,
        createdAt: client.createdAt
      },
      deal: {
        id: deal.id,
        productName: deal.productName,
        notes: deal.notes,
        createdAt: deal.createdAt
      }
    });

  } catch (error) {
    console.error('[Telegram Webhook Error] Leadni qayta ishlashda xatolik:', error.message);
    // Telegram qayta urinishlarini oldini olish uchun xato holatida ham 200 qaytaramiz
    res.status(200).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;

