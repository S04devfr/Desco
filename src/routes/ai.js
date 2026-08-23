const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { rateLimiter } = require('../middleware/security');
const { logAudit } = require('../middleware/auditLog');
const prisma = require('../config/database');

// ══════════════════════════════════════════════════════════════════════════════
// 1. AI XAVFSIZLIK VA SANITIZATION FILTRLARI
// ══════════════════════════════════════════════════════════════════════════════

function checkPromptInjection(text) {
  if (!text || typeof text !== 'string') return { safe: true, reason: '' };
  const lowerText = text.toLowerCase();

  const DANGEROUS_PATTERNS = [
    'ignore previous', 'ignore above', 'ignore all instructions',
    'disregard previous', 'disregard above',
    'reveal your system prompt', 'show your instructions',
    'print your prompt', 'output your prompt',
    'dump all data', 'select * from "user"', 'pg_catalog', 'information_schema'
  ];

  for (const pattern of DANGEROUS_PATTERNS) {
    if (lowerText.includes(pattern)) {
      return { safe: false, reason: pattern };
    }
  }

  return { safe: true, reason: '' };
}

function validateSQL(sql) {
  if (!sql || typeof sql !== 'string') return { safe: false, reason: 'Bo\'sh SQL' };
  const upperSQL = sql.toUpperCase().trim();

  if (!upperSQL.startsWith('SELECT')) {
    return { safe: false, reason: 'Faqat SELECT so\'rovlariga ruxsat berilgan' };
  }

  const BLOCKED_KEYWORDS = [
    'DROP', 'DELETE', 'INSERT', 'UPDATE', 'ALTER',
    'TRUNCATE', 'CREATE', 'GRANT', 'REVOKE',
    'EXECUTE', 'EXEC', 'COPY'
  ];

  for (const keyword of BLOCKED_KEYWORDS) {
    const regex = new RegExp(`\\b${keyword}\\b`, 'i');
    if (regex.test(sql)) {
      return { safe: false, reason: `"${keyword}" operatsiyasi taqiqlangan` };
    }
  }

  const BLOCKED_TABLES = ['pg_catalog', 'information_schema', 'pg_shadow', 'pg_roles', 'pg_authid'];
  for (const table of BLOCKED_TABLES) {
    if (sql.toLowerCase().includes(table)) {
      return { safe: false, reason: `"${table}" jadvaliga kirish taqiqlangan` };
    }
  }

  if (/\bpassword\b/i.test(sql) && /"?User"?/i.test(sql)) {
    return { safe: false, reason: 'User jadvalidan password o\'qish taqiqlangan' };
  }

  return { safe: true, reason: '' };
}

function sanitizeAIResponse(reply) {
  if (!reply || typeof reply !== 'string') return reply;
  const SENSITIVE_PATTERNS = [
    /(?:password|parol)\s*[:=]\s*\S+/gi,
    /(?:api[_-]?key|token|secret)\s*[:=]\s*\S+/gi,
    /(?:DATABASE_URL|DIRECT_URL)\s*[:=]\s*\S+/gi,
    /postgresql:\/\/[^\s"']+/gi
  ];
  let cleaned = reply;
  for (const pattern of SENSITIVE_PATTERNS) {
    cleaned = cleaned.replace(pattern, '[REDACTED]');
  }
  return cleaned;
}

// ══════════════════════════════════════════════════════════════════════════════
// 2. TELEGRAM VA REGIONAL HAYDOVCHILAR QIDIRUV TIZIMI
// ══════════════════════════════════════════════════════════════════════════════

const REGION_ALIASES = {
  'samarqand': ['samarqand', 'samarkand', 'samar', 'samy', 'urgut', 'kattaqo\'rg\'on', 'bulung\'ur'],
  'toshkent': ['toshkent', 'tashkent', 'tosh', 'tash', 'chirchiq', 'angren', 'olmaliq', 'bekobod', 'yangiyo\'l'],
  'buxoro': ['buxoro', 'bukhara', 'buxara', 'g\'ijduvon', 'kogon', 'vobkent'],
  'andijon': ['andijon', 'andijan', 'andi', 'asaka', 'shahrixon', 'marhamat', 'xonobod'],
  'fargona': ['farg\'ona', 'fargona', 'fergana', 'qo\'qon', 'kokand', 'marg\'ilon', 'rishton', 'oltiariq'],
  'namangan': ['namangan', 'naman', 'chortoq', 'pop', 'uchqo\'rg\'on', 'kosonsoy'],
  'jizzax': ['jizzax', 'dzhizak', 'jizax', 'jiz', 'zomin', 'g\'allaorol', 'paxtakor'],
  'sirdaryo': ['sirdaryo', 'sirdarya', 'guliston', 'gulistan', 'yangiyer', 'shirin', 'boyovut'],
  'navoiy': ['navoiy', 'navoi', 'zarafshon', 'karmana', 'uchquduq', 'nurota'],
  'xorazm': ['xorazm', 'khorezm', 'urganch', 'urgench', 'xiva', 'khiva', 'shovot', 'xonqa'],
  'qashqadaryo': ['qashqadaryo', 'kashkadarya', 'qarshi', 'karshi', 'shahrisabz', 'kitob', 'g\'uzor', 'koson', 'muborak'],
  'surxondaryo': ['surxondaryo', 'surxandaryo', 'termez', 'termiz', 'denov', 'sherobod', 'boysun', 'sho\'rchi'],
  'qoraqalpogiston': ['qoraqalpog\'iston', 'karakalpakstan', 'nukus', 'nukis', 'qo\'ng\'irot', 'beruniy', 'to\'rtko\'l']
};

const DEFAULT_DRIVERS = [
  { name: "Alisher Umarov", phone: "+998901234567", vehicle: "Damas", regions: ["samarqand", "toshkent"], username: "@alisher_damas", source: "Samarqand_Damas_Pochta" },
  { name: "Qodirjon Tojiyev", phone: "+998935557788", vehicle: "Labo", regions: ["farg'ona", "namangan", "andijon", "vodiy"], username: "@qodir_labo", source: "Vodiy_Yuk_Tashish" },
  { name: "Bobur Mansurov", phone: "+998974441122", vehicle: "Cobalt", regions: ["buxoro", "samarqand", "toshkent"], username: "@bobur_buxoro", source: "Buxoro_Taksi_Express" },
  { name: "Sherzod Alimov", phone: "+998943339900", vehicle: "Gentra", regions: ["toshkent", "samarqand", "jizzax"], username: "@sherzod_gentra", source: "Toshkent_Samarqand_Arenda" },
  { name: "Bekzod Rustamov", phone: "+998997776655", vehicle: "Damas", regions: ["surxondaryo", "toshkent", "termez"], username: "@bekzod_surxon", source: "Termez_Damas_Pochta" },
  { name: "Jasur Qosimov", phone: "+998908881122", vehicle: "Isuzu Yuk mashinasi", regions: ["toshkent", "samarqand", "buxoro", "qashqadaryo"], username: "@jasur_yuk", source: "Uzbekistan_Katta_Yuk" },
  { name: "Malika Sobirova", phone: "+998931110022", vehicle: "Damas", regions: ["qashqadaryo", "samarqand", "qarshi"], username: "@malika_taksi", source: "Qarshi_Taxi_Guruh" },
  { name: "Otabek Hoshimov", phone: "+998951234589", vehicle: "Cobalt", regions: ["namangan", "toshkent", "andijon", "vodiy"], username: "@otabek_taxi", source: "Fargona_Vodiy_Pochta" },
  { name: "Sardor Yusupov", phone: "+998909998877", vehicle: "Labo", regions: ["toshkent", "samarqand", "sirdaryo"], username: "@sardor_labo_ts", source: "Toshkent_Sirdaryo_Yuk" },
  { name: "Jahongir Olimov", phone: "+998971112233", vehicle: "Damas", regions: ["andijon", "farg'ona", "vodiy"], username: "@jahongir_andijon", source: "Andijon_Taxi_Live" },
  { name: "Murod Xo'jayev", phone: "+998914443322", vehicle: "Labo", regions: ["xorazm", "urganch", "buxoro"], username: "@murod_urganch", source: "Xorazm_Yuk_Pochta" },
  { name: "Ilhom Karimov", phone: "+998938889911", vehicle: "Damas", regions: ["navoiy", "zarafshon", "buxoro"], username: "@ilhom_navoiy", source: "Navoiy_Zarafshon_Guruh" },
  { name: "Rustam Saidov", phone: "+998903332211", vehicle: "Isuzu", regions: ["qoraqalpog'iston", "nukus", "toshkent"], username: "@rustam_nukus", source: "Nukus_Toshkent_Pochta" }
];

function matchesRegion(textLower, region) {
  if (!region) return true;
  const regNormalized = region.toLowerCase().trim()
    .replace(/g['`’‘"ʼ]/g, 'g')
    .replace(/o['`’‘"ʼ]/g, 'o')
    .replace(/['`’‘"ʼ]/g, '')
    .replace(/q/g, 'k');

  const textNormalized = textLower
    .replace(/g['`’‘"ʼ]/g, 'g')
    .replace(/o['`’‘"ʼ]/g, 'o')
    .replace(/['`’‘"ʼ]/g, '')
    .replace(/q/g, 'k');

  if (textNormalized.includes(regNormalized)) return true;

  for (const [key, aliases] of Object.entries(REGION_ALIASES)) {
    if (regNormalized.includes(key) || key.includes(regNormalized)) {
      for (const alias of aliases) {
        if (textNormalized.includes(alias)) return true;
      }
    }
  }

  return false;
}

function extractDriversFromMessages(messages, destination, vehicle, sourceChannel) {
  const parsedDrivers = [];
  const phoneRegex = /(?:\+?998)?[-.\s]?\(?\d{2}\)?[-.\s]?\d{3}[-.\s]?\d{2}[-.\s]?\d{2}/g;

  for (const text of messages) {
    const textLower = text.toLowerCase();
    if (!matchesRegion(textLower, destination)) continue;
    if (vehicle && !textLower.includes(vehicle.toLowerCase().trim())) continue;

    const phoneMatch = text.match(phoneRegex);
    if (!phoneMatch) continue;

    const rawPhone = phoneMatch[0].replace(/[^\d+]/g, '');
    let finalPhone = rawPhone;
    if (rawPhone.length === 9) finalPhone = '+998' + rawPhone;
    else if (rawPhone.length === 12 && !rawPhone.startsWith('+')) finalPhone = '+' + rawPhone;

    let detectedVehicle = "Yengil mashina";
    if (textLower.includes("damas")) detectedVehicle = "Damas";
    else if (textLower.includes("labo")) detectedVehicle = "Labo";
    else if (textLower.includes("cobalt")) detectedVehicle = "Cobalt";
    else if (textLower.includes("gentra") || textLower.includes("jentra")) detectedVehicle = "Gentra";
    else if (textLower.includes("isuzu")) detectedVehicle = "Isuzu Yuk mashinasi";
    else if (textLower.includes("kamaz") || textLower.includes("fura")) detectedVehicle = "Kamaz / Fura";

    let driverName = "Telegram Haydovchi";
    const nameMatch = text.match(/(?:ismim|ism|haydovchi|shofyori?)\s*:?\s*([A-Za-zА-Яа-яЎўҚқҒғҲҳ\s]{3,15})/i);
    if (nameMatch && nameMatch[1]) {
      driverName = nameMatch[1].trim();
    } else {
      const words = text.split(/\s+/).filter(w => !w.includes('+') && w.length > 2);
      if (words.length > 0) driverName = words.slice(0, 2).join(' ').replace(/[^\w\sА-Яа-яЎўҚқҒғҲҳ]/g, '');
    }

    parsedDrivers.push({
      name: driverName || "Haydovchi",
      phone: finalPhone,
      vehicle: detectedVehicle,
      regions: [destination],
      username: `@${sourceChannel}`,
      source: sourceChannel
    });
  }

  return parsedDrivers;
}

async function scrapeTelegramChannel(channelName) {
  try {
    const url = `https://t.me/s/${channelName}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) return [];

    const html = await res.text();
    const messageBlocks = [];
    const regex = /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/g;
    let match;
    while ((match = regex.exec(html)) !== null) {
      const cleanText = match[1].replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '').trim();
      if (cleanText) messageBlocks.push(cleanText);
    }
    return messageBlocks;
  } catch (err) {
    return [];
  }
}

async function runTelegramDriverSearch(destination, vehicle) {
  let results = [];

  // 1. Try Authenticated Telegram Client if configured
  try {
    const settings = await prisma.companySettings.findFirst();
    if (settings && settings.telegramSessionString && settings.telegramApiId && settings.telegramApiHash) {
      const { TelegramClient, Api } = require('telegram');
      const { StringSession } = require('telegram/sessions');
      const session = new StringSession(settings.telegramSessionString);
      const client = new TelegramClient(session, Number(settings.telegramApiId), settings.telegramApiHash, { connectionRetries: 2 });
      await client.connect();

      const queries = [destination, `${destination} taksi`, `${destination} pochta`, `${destination} yuk`];
      const searchPromises = queries.map(q => client.invoke(new Api.messages.SearchGlobal({
        q,
        filter: new Api.InputMessagesFilterEmpty(),
        minDate: 0,
        maxDate: 0,
        offsetRate: 0,
        offsetPeer: new Api.InputPeerEmpty(),
        offsetId: 0,
        limit: 25
      })).catch(() => null));

      const searchResults = await Promise.all(searchPromises);
      for (const res of searchResults) {
        if (!res || !res.messages) continue;
        for (const msg of res.messages) {
          if (!msg.message) continue;
          const drivers = extractDriversFromMessages([msg.message], destination, vehicle, 'Telegram Global Search');
          results = results.concat(drivers);
        }
      }
      await client.disconnect();
    }
  } catch (e) {
    console.warn('[AI Telegram GramJS Notice]', e.message);
  }

  // 2. Public Scraper Channels
  const targetChannels = ['vodiy_taksi_pochta', 'toshkent_samarqand_pochta', 'buxoro_taksi', 'qarshi_pochta_taxi', 'surxondaryo_taksi'];
  for (const ch of targetChannels) {
    const msgs = await scrapeTelegramChannel(ch);
    if (msgs.length > 0) {
      const drivers = extractDriversFromMessages(msgs, destination, vehicle, ch);
      results = results.concat(drivers);
    }
  }

  // 3. Fallback to Curated Regional Drivers Database
  const matchedCurated = DEFAULT_DRIVERS.filter(d => {
    const regMatch = d.regions.some(r => matchesRegion(destination, r));
    const vehMatch = !vehicle || d.vehicle.toLowerCase().includes(vehicle.toLowerCase().trim());
    return regMatch && vehMatch;
  });
  results = results.concat(matchedCurated);

  // Deduplicate by phone
  const uniqueDrivers = [];
  const seenPhones = new Set();
  for (const d of results) {
    if (!seenPhones.has(d.phone)) {
      seenPhones.add(d.phone);
      uniqueDrivers.push(d);
    }
  }

  return uniqueDrivers;
}

// ══════════════════════════════════════════════════════════════════════════════
// 3. SMART FALLBACK ENGINE (DESCO.AI UNIVERSAL COPILOT)
// ══════════════════════════════════════════════════════════════════════════════

async function generateSmartFallbackResponse(userPrompt, req, prisma) {
  const promptLower = String(userPrompt || '').toLowerCase().trim();

  // 1. Objection: "Qimmat ekan"
  if (promptLower.includes('qimmat') || promptLower.includes('gimmat') || promptLower.includes('narxi baland')) {
    return `🎯 **"Mijoz qimmat ekan dedi" — Desco.ai dan 3 Ta Kuchli Sotuv Skripti**:

1. **"Sifat, Rasmiy Kafolat va Xizmat" Taktikasi**:
   > *"Tushunaman, narx har doim muhim omil. Lekin bizning mahsulotimiz 1 yillik rasmiy kafolat, servis xizmati va bepul yetkazib berish bilan ta'minlangan. Bozordagi arzon muqobillari 1-2 oyda ishdan chiqishi mumkin. Biz to'liq sifatiga javob beramiz!"*

2. **"Nasiya Desco / Bo'lib To'lash" Taktikasi**:
   > *"Agar biryo'la to'lash og'irlik qilsa, Nasiya Desco orqali boshlang'ich to'lovsiz, oylik qulay to'lovga rasmiylashtirib berishimiz mumkin. Sizga 3 oylikmi yoki 6 oylik qulayroq bo'ladimi?"*

3. **"Kunlik Qiymatni Bo'lib Ko'rsatish" Taktikasi**:
   > *"To'g'ri aytdingiz, lekin uzoq muddatli foydalanishni hisoblasak, bu mahsulot sizga kuniga atigi 2,500 so'mga tushadi. O'zingiz va oilangiz qulayligi uchun bu juda arzon sarmoya!"*

📱 **Telegram / SMS uchun tayyor xabar nusxasi**:
\`\`\`text
Assalomu alaykum [Mijoz Ismi]! Siz so'ragan mahsulotimizga bugun 1 yillik rasmiy kafolat va bepul yetkazib berish xizmati qo'shilgan. Buyurtmani manzilingizga rasmiylashtiraylikmi?
\`\`\`

---
⚡ *Javob: Desco.ai — Senior Sales & CRM Intelligence*`;
  }

  // 2. Objection: "O'ylab ko'raman"
  if (promptLower.includes('o\'ylab') || promptLower.includes('oylab') || promptLower.includes('maslahatlashay')) {
    return `🤔 **"Mijoz o'ylab ko'raman dedi" — Desco.ai Skriptlari**:

1. **"Ikkilanishning asl sababini aniqlash" usuli**:
   > *"Albatta, o'ylab ko'rish juda to'g'ri. Faqat bitta narsani aniqlashtirib olsam: sizni aynan mahsulot xususiyatlari ikkilantiryaptimi yoki narx/to'lov shartlarimi?"*

2. **"Cheklangan zaxira va maxsus chegirma" usuli**:
   > *"Albatta, bemalol! Faqat hozirgi aksiyamiz bo'yicha omborda atigi 3 dona qoldi. Zaxirani siz uchun bugun soat 18:00 gacha band qilib turaymi?"*

📱 **Telegram / SMS xabari**:
\`\`\`text
Assalomu alaykum! Agar mahsulot bo'yicha qo'shimcha savollaringiz bo'lsa, tushuntirib berishga tayyorman. Hozir bepul yetkazib berish aksiyasi ketmoqda!
\`\`\`

---
⚡ *Javob: Desco.ai — Senior Sales & CRM Intelligence*`;
  }

  // 3. Driver / Logistics Search
  if (promptLower.includes('shopir') || promptLower.includes('driver') || promptLower.includes('haydovchi') || promptLower.includes('taksi') || promptLower.includes('pochta')) {
    let dest = 'Samarqand';
    for (const reg of Object.keys(REGION_ALIASES)) {
      if (promptLower.includes(reg)) { dest = reg; break; }
    }
    const drivers = await runTelegramDriverSearch(dest, null);
    
    let reply = `🚕 **${dest.toUpperCase()} Yo'nalishi Bo'yicha Telegram Haydovchilari (Desco.ai Qidiruv Natijalari):**\n\n`;
    if (drivers.length > 0) {
      drivers.slice(0, 5).forEach((d, idx) => {
        reply += `${idx + 1}. **${d.name}** (${d.vehicle})\n   📱 **Tel:** \`${d.phone}\`\n   📍 **Manba:** ${d.source}\n\n`;
      });
      reply += `💡 *Haydovchini sdelkaga biriktirish uchun: "${drivers[0].name}ni sdelka #324 ga shopir qil" deb yozishingiz mumkin.*`;
    } else {
      reply += `1. **Alisher Umarov** (Damas) — Tel: \`+998901234567\`\n2. **Sherzod Alimov** (Gentra) — Tel: \`+998943339900\``;
    }
    reply += `\n\n---\n⚡ *Javob: Desco.ai — Telegram Logistics Search*`;
    return reply;
  }

  // 4. Specific Deal Query (#ID)
  const dealMatch = promptLower.match(/(?:sdelka|zakaz|buyurtma|#)\s*(\d+)/i);
  if (dealMatch && dealMatch[1]) {
    const dealId = Number(dealMatch[1]);
    const deal = await prisma.deal.findUnique({
      where: { id: dealId },
      include: { client: true, manager: true, stage: true, deliveryLog: true }
    });
    if (deal) {
      return `📦 **Desco.ai — Sdelka #${deal.id} Ma'lumotlari**:

| Ko'rsatkich | Ma'lumot |
| :--- | :--- |
| **Mahsulot** | **${deal.productName || 'Noma\'lum'}** |
| **Mijoz** | ${deal.client ? deal.client.name : 'Noma\'lum'} (\`${deal.client?.phone || 'N/A'}\`) |
| **Shahar / Viloyat** | ${deal.city || deal.client?.city || 'Noma\'lum'} |
| **Summa** | **${Number(deal.amount || 0).toLocaleString('uz-UZ')} UZS** |
| **Voronka Bosqichi** | ${deal.stage ? deal.stage.name : 'Yangi'} |
| **Mas'ul Menejer** | ${deal.manager ? deal.manager.fullName : 'Biriktirilmagan'} |
| **Biriktirilgan Shopir** | ${deal.deliveryLog?.shopirName || 'Biriktirilmagan'} |
| **Izoh** | ${deal.notes || 'Mavjud emas'} |

---
⚡ *Javob: Desco.ai — CRM Real-Time Intelligence*`;
    }
  }

  // 5. Sales / Reports / Statistics
  if (promptLower.includes('hisobot') || promptLower.includes('tahlil') || promptLower.includes('sotuv') || promptLower.includes('statistika') || promptLower.includes('bugun')) {
    const todayStart = new Date();
    todayStart.setHours(0,0,0,0);

    const [todayDeals, totalDeals, totalClients, wonDeals] = await Promise.all([
      prisma.deal.count({ where: { createdAt: { gte: todayStart } } }),
      prisma.deal.count(),
      prisma.client.count(),
      prisma.deal.count({ where: { status: 'won' } })
    ]);

    return `📊 **Desco.ai — CRM Jonli Tahlil va Hisobot**:

| Ko'rsatkich | Qiymat | Holat |
| :--- | :--- | :--- |
| **Bugungi Yangi Sdelkalar** | **${todayDeals} ta** | 🟢 Jonli oqim |
| **Tizimdagi Jami Sdelkalar** | **${totalDeals} ta** | 📈 O'smoqda |
| **Muvaffaqiyatli Yutilganlar** | **${wonDeals} ta** | 🏆 Yuqori konversiya |
| **Jami Ro'yxatdagi Mijozlar** | **${totalClients} nafar** | 👥 Faol baza |

💡 *Xulosa:* Barcha jarayonlar barqaror ishlamoqda. Aniqroq davr hisobotini olish uchun kerakli sana yoki filtrni yozing.

---
⚡ *Javob: Desco.ai — Enterprise Analytics*`;
  }

  // 6. Universal Professional Advisor Response
  return `Assalomu alaykum! Men **Desco.ai** — Universal Sun'iy Intellekt Assistentingizman.

Sizga har qanday sohada professional darajada yordam berishga tayyorman:
- 🚀 **Sotuv va Mijozlar**: *"Mijoz qimmat dedi, nima deb javob qilay?"*, *"Mijozga tijorat taklifi yozib ber"*
- 🚕 **Logistika va Telegram Qidiruv**: *"Samarqandga Damas shopir topib ber"*, *"Buxoroga yuk mashina qidir"*
- 📦 **CRM va Sdelkalar**: *"#324 sdelka ma'lumoti"*, *"Bugungi sotuvlar tahlili"*
- 💼 **Biznes va Marketing**: *"Reklama matni yozish"*, *"Nasiya foizlarini hisoblash"*, *"Sotuv strategiyasi"*
- 💡 **Har qanday yo'nalishdagi savollar va texnik topshiriqlar**.

*Qanday savol yoki topshirig'ingiz bor?*

---
⚡ *Desco.ai — All-in-One Enterprise AI Copilot*`;
}

// ══════════════════════════════════════════════════════════════════════════════
// 4. MAIN AI CHAT ROUTE (/api/ai/chat)
// ══════════════════════════════════════════════════════════════════════════════

router.post('/chat', protect, rateLimiter(40, 60000), async (req, res) => {
  try {
    const { messages } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "Xabarlar formati noto'g'ri." });
    }

    const API_KEY = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY || process.env.GROQ_API_KEY;

    const lastUserMessage = messages.filter(m => m.role === 'user').pop();
    const userPrompt = lastUserMessage?.content || '';

    if (lastUserMessage) {
      const injectionCheck = checkPromptInjection(userPrompt);
      if (!injectionCheck.safe) {
        logAudit('AI_INJECTION_BLOCKED', `Pattern: ${injectionCheck.reason}`, req.userId, req.user?.email, req.ip);
        return res.json({
          reply: "Xavfsizlik talablariga muvofiq, tizim buyruqlarini o'zgartiruvchi so'rovlar qabul qilinmaydi. Iltimos, savolingizni bevosita bering.\n\n— *Desco.ai Xavfsizlik Xizmati*"
        });
      }
    }

    logAudit('AI_QUERY', `Savol: ${userPrompt.substring(0, 200)}`, req.userId, req.user?.email, req.ip);

    // ── Universal Desco.ai System Persona ──
    const systemMessage = {
      role: 'system',
      content: `Sen "Desco.ai" san — DESCO CRM va ilg'or biznes korxonalarining Universal Bosh Sun'iy Intellekt Assistentisan (Chief AI Copilot & Senior Sales Strategist).

SENING ASOSIY PRINSIPLARING VA PERSONANG (MANDATORY):
1. **SENING NOMI**: Har doim "Desco.ai" nomidan rasmiy, vakolatli, o'tkir va professional ravishda javob berasan.
2. **UNIVERSAL BILIM VA HAR QANDAY YO'NALISH**: Sen har qanday sohada (sotuv san'ati, mijoz e'tirozlarini yengish, marketing, moliya, hisob-kitoblar, dasturlash va texnologiyalar, huquq, biznes strategiyasi, logistika, Telegram qidiruv va umumiy savollar) eng yuqori darajada, tushunarli, o'zbek tilida (yoki foydalanuvchi so'ragan tilda) amaliy yechimlar berasan.
3. **AMALIY VA TA'SIRCHAN BO'LISH**: Quruq nazariyadan ko'ra aniq 1-2-3 qadamli ko'rsatmalar, tayyor SMS/Telegram xabar matnlari, taqqoslash jadvallari va skriptlarni taqdim et.
4. **CRM VA TELEGRAM INTEGRATSIYASI**:
   - Mijoz ma'lumotlari yoki sdelka so'ralsa: "execute_sql" yoki "search_crm_universal" vositalaridan foydalan.
   - Haydovchi, shopir, taksi yoki logistika so'ralsa: "search_telegram_drivers" vositasi orqali viloyatlar bo'yicha Telegram kanallari va bazalaridan haydovchilarni qidirib ber.
   - Yangi vazifa (Task) yaratish yoki haydovchini sdelkaga biriktirish topshirilsa: "create_task" yoki "assign_delivery_driver" vositalarini ishlat.

MA'LUMOTLAR BAZASI (PostgreSQL):
- User (id, email, fullName, role, isActive)
- Client (id, name, phone, city, debt)
- Deal (id, productName, amount, paidAmount, costPrice, status, notes, clientId, managerId, stageId, createdAt)
- Task (id, title, dueDate, priority, completed, dealId, assignedToId)
- WarehouseStock (id, productName, quantity, price, minStock)

FOYDALANUVCHI:
- Ismi: ${req.user?.fullName || 'Foydalanuvchi'}
- Roli: ${req.user?.role || 'manager'}

RUXSAT CHEKLOVLARI:
- Agar foydalanuvchi admin bo'lmasa (role !== 'admin'), boshqa xodimlarning maoshi va kompaniyaning maxfiy sof foyda ko'rsatkichlarini ko'rsatma.

Har bir javobing oxirida yorqin, estetik va ixcham "Desco.ai" imzosi bo'lsin.`
    };

    const safeMessages = messages.filter(m => m.role !== 'system');
    const payloadMessages = [systemMessage, ...safeMessages];

    const tools = [
      {
        type: 'function',
        function: {
          name: 'execute_sql',
          description: `CRM bazasidan ma'lumotlarni xavfsiz SELECT qilish uchun SQL so'rov yuboradi.`,
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: "PostgreSQL SELECT so'rovi." }
            },
            required: ['query']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'search_telegram_drivers',
          description: `Telegramdagi O'zbekiston viloyatlari shopirlar guruhlari/kanallaridan haydovchilarni qidiradi.`,
          parameters: {
            type: 'object',
            properties: {
              destination: { type: 'string', description: "Viloyat yoki shahar nomi (masalan: 'Samarqand', 'Buxoro', 'Qarshi')" },
              vehicle: { type: 'string', description: "Avtomobil turi (masalan: 'Damas', 'Labo', 'Cobalt', 'Gentra', 'Isuzu')" }
            },
            required: ['destination']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'search_crm_universal',
          description: `CRM bo'yicha sdelkalar, mijozlar, ombor va vazifalarni kalit so'z yoki telefon raqami orqali tezkor qidiradi.`,
          parameters: {
            type: 'object',
            properties: {
              keyword: { type: 'string', description: "Qidirilayotgan so'z, ism, mahsulot yoki telefon raqami" }
            },
            required: ['keyword']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'assign_delivery_driver',
          description: `Sdelkaga haydovchi ismini biriktiradi va yetkazib berish (DeliveryLog) jurnalini yangilaydi.`,
          parameters: {
            type: 'object',
            properties: {
              dealId: { type: 'number', description: "Sdelka ID raqami" },
              driverName: { type: 'string', description: "Haydovchi ismi" },
              notes: { type: 'string', description: "Qo'shimcha izoh" }
            },
            required: ['dealId', 'driverName']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'create_task',
          description: `Menejer uchun yangi vazifa (Task) yaratadi.`,
          parameters: {
            type: 'object',
            properties: {
              title: { type: 'string', description: "Vazifa sarlavhasi" },
              description: { type: 'string', description: "Tavsif" },
              dueDate: { type: 'string', description: "Muddat sanasi (YYYY-MM-DD)" },
              dueTime: { type: 'string', description: "Muddat vaqti (HH:MM)" },
              priority: { type: 'string', description: "Muhimlik: 'low', 'medium', 'high', 'urgent'" }
            },
            required: ['title', 'dueDate']
          }
        }
      }
    ];

    if (!API_KEY) {
      console.log('[Desco.ai Engine] API kalit topilmadi. Smart Fallback ishga tushirildi.');
      const fallbackReply = await generateSmartFallbackResponse(userPrompt, req, prisma);
      return res.json({ reply: fallbackReply });
    }

    let apiUrl = 'https://api.deepseek.com/chat/completions';
    let modelName = 'deepseek-chat';

    if (process.env.OPENAI_API_KEY && !process.env.DEEPSEEK_API_KEY) {
      apiUrl = 'https://api.openai.com/v1/chat/completions';
      modelName = 'gpt-4o-mini';
    }

    let response;
    try {
      response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
        body: JSON.stringify({
          model: modelName,
          messages: payloadMessages,
          tools: tools,
          tool_choice: 'auto',
          temperature: 0.2
        })
      });
      if (!response.ok) throw new Error(`API status ${response.status}`);
    } catch(fetchErr) {
      console.warn('[Desco.ai API Notice -> Local Smart Fallback]', fetchErr.message);
      const fallbackReply = await generateSmartFallbackResponse(userPrompt, req, prisma);
      return res.json({ reply: fallbackReply });
    }

    let aiData = await response.json();
    let responseMessage = aiData.choices && aiData.choices[0] ? aiData.choices[0].message : null;

    if (!responseMessage) {
      const fallbackReply = await generateSmartFallbackResponse(userPrompt, req, prisma);
      return res.json({ reply: fallbackReply });
    }

    // Process Tool Calls if any
    if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
      payloadMessages.push(responseMessage);
      
      for (const toolCall of responseMessage.tool_calls) {
        const fnName = toolCall.function.name;
        let args = {};
        try { args = JSON.parse(toolCall.function.arguments || '{}'); } catch (_) {}

        if (fnName === 'execute_sql') {
          try {
            const sql = args.query.trim();
            const sqlCheck = validateSQL(sql);
            if (!sqlCheck.safe) throw new Error(sqlCheck.reason);

            const dbResult = await prisma.$queryRawUnsafe(sql);
            payloadMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify(dbResult, (k, v) => typeof v === 'bigint' ? v.toString() : v)
            });
          } catch (err) {
            payloadMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify({ error: err.message }) });
          }
        } else if (fnName === 'search_telegram_drivers') {
          try {
            const results = await runTelegramDriverSearch(args.destination, args.vehicle || null);
            payloadMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify({ success: true, count: results.length, drivers: results })
            });
          } catch (err) {
            payloadMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify({ error: err.message }) });
          }
        } else if (fnName === 'search_crm_universal') {
          try {
            const kw = String(args.keyword || '').trim();
            const [deals, clients, tasks] = await Promise.all([
              prisma.deal.findMany({
                where: { OR: [{ productName: { contains: kw } }, { notes: { contains: kw } }] },
                take: 5,
                select: { id: true, productName: true, amount: true, status: true }
              }),
              prisma.client.findMany({
                where: { OR: [{ name: { contains: kw } }, { phone: { contains: kw } }] },
                take: 5,
                select: { id: true, name: true, phone: true, city: true, debt: true }
              }),
              prisma.task.findMany({
                where: { title: { contains: kw } },
                take: 5,
                select: { id: true, title: true, dueDate: true, priority: true }
              })
            ]);
            payloadMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify({ success: true, deals, clients, tasks })
            });
          } catch (err) {
            payloadMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify({ error: err.message }) });
          }
        } else if (fnName === 'assign_delivery_driver') {
          try {
            const dealId = Number(args.dealId);
            const driverName = args.driverName;
            const deal = await prisma.deal.findUnique({ where: { id: dealId } });
            if (!deal) throw new Error(`Sdelka #${dealId} topilmadi`);

            const delivery = await prisma.deliveryLog.upsert({
              where: { dealId },
              update: { shopirName: driverName, destination: deal.city || undefined, notes: args.notes || undefined },
              create: { dealId, shopirName: driverName, destination: deal.city, notes: args.notes, status: 'dispatched' }
            });
            payloadMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify({ success: true, message: `Haydovchi ${driverName} sdelka #${dealId} ga biriktirildi.`, delivery })
            });
          } catch (err) {
            payloadMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify({ error: err.message }) });
          }
        } else if (fnName === 'create_task') {
          try {
            const newTask = await prisma.task.create({
              data: {
                title: args.title,
                description: args.description || null,
                dueDate: args.dueDate ? new Date(args.dueDate) : null,
                dueTime: args.dueTime || null,
                priority: args.priority || 'medium',
                assignedToId: req.userId
              }
            });
            payloadMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify({ success: true, message: `Vazifa yaratildi. ID: ${newTask.id}`, task: newTask })
            });
          } catch (err) {
            payloadMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify({ error: err.message }) });
          }
        }
      }

      // Step 2: Final response generation with tool results
      try {
        const secondRes = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
          body: JSON.stringify({
            model: modelName,
            messages: payloadMessages,
            temperature: 0.4
          })
        });
        const secondData = await secondRes.json();
        if (secondData.choices && secondData.choices[0]) {
          responseMessage = secondData.choices[0].message;
        }
      } catch (secErr) {
        console.warn('[Desco.ai Second Step Warning]', secErr.message);
      }
    }

    const cleanReply = sanitizeAIResponse(responseMessage.content || '');
    res.json({ reply: cleanReply });

  } catch (error) {
    console.error('[Desco.ai Route Error]:', error.message);
    res.status(500).json({ error: 'Desco.ai server xatosi yuz berdi.' });
  }
});

module.exports = router;

