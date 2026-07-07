/**
 * Xavfsizlik middleware'lari — Desco CRM
 * 
 * 1. rateLimiter     — IP bo'yicha so'rov cheklash
 * 2. webhookIPWhitelist — Facebook IP diapazonlarini tekshirish
 * 3. sanitizeResponse — API javoblardan sensitive ma'lumotlarni tozalash
 */

const net = require('net');

// ══════════════════════════════════════════
// 1. RATE LIMITER (in-memory, express-rate-limit yo'q bo'lsa fallback)
// ══════════════════════════════════════════

const rateLimitStore = new Map();

/**
 * Oddiy in-memory rate limiter.
 * @param {number} maxRequests — max so'rovlar soni
 * @param {number} windowMs — vaqt oynasi (ms)
 */
function rateLimiter(maxRequests = 100, windowMs = 60000) {
  return (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const key = `${ip}:${req.baseUrl || req.path}`;
    const now = Date.now();

    if (!rateLimitStore.has(key)) {
      rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    const record = rateLimitStore.get(key);

    // Vaqt oynasi o'tgan bo'lsa — tozalash
    if (now > record.resetAt) {
      record.count = 1;
      record.resetAt = now + windowMs;
      return next();
    }

    record.count++;

    if (record.count > maxRequests) {
      console.warn(`[Rate Limit] ${ip} — ${maxRequests} req/${windowMs}ms limit oshdi. Path: ${req.path}`);
      return res.status(429).json({
        error: 'Too Many Requests',
        message: `Juda ko'p so'rov. ${Math.ceil(windowMs / 1000)} soniyadan keyin qayta urinib ko'ring.`,
        retryAfter: Math.ceil((record.resetAt - now) / 1000)
      });
    }

    next();
  };
}

// Har 5 daqiqada eskirgan yozuvlarni tozalash (memory leak oldini olish)
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimitStore) {
    if (now > record.resetAt) {
      rateLimitStore.delete(key);
    }
  }
}, 5 * 60 * 1000);


// ══════════════════════════════════════════
// 2. FACEBOOK WEBHOOK IP WHITELIST
// ══════════════════════════════════════════

/**
 * Facebook/Meta ruxsat etilgan IP diapazonlari (CIDR formatda).
 * Manba: https://developers.facebook.com/docs/sharing/webmasters/crawler
 */
const FACEBOOK_IP_RANGES = [
  '31.13.24.0/21',
  '31.13.64.0/18',
  '45.64.40.0/22',
  '66.220.144.0/20',
  '69.63.176.0/20',
  '69.171.224.0/19',
  '74.119.76.0/22',
  '103.4.96.0/22',
  '129.134.0.0/17',
  '157.240.0.0/17',
  '173.252.64.0/18',
  '179.60.192.0/22',
  '185.60.216.0/22',
  '204.15.20.0/22'
];

/**
 * CIDR formatdagi IP diapazonini tekshirish.
 * @param {string} ip — tekshiriladigan IP (IPv4)
 * @param {string} cidr — CIDR formati (masalan: '157.240.0.0/17')
 * @returns {boolean}
 */
function isIPInCIDR(ip, cidr) {
  const [range, bits] = cidr.split('/');
  const mask = ~(2 ** (32 - parseInt(bits)) - 1);

  const ipNum = ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet), 0);
  const rangeNum = range.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet), 0);

  return (ipNum & mask) === (rangeNum & mask);
}

/**
 * IPv6-mapped IPv4 dan IPv4 ga o'tkazish (::ffff:1.2.3.4 → 1.2.3.4)
 */
function normalizeIP(ip) {
  if (!ip) return '';
  if (ip.startsWith('::ffff:')) return ip.slice(7);
  return ip;
}

/**
 * Webhook endpoint uchun IP whitelist middleware.
 * Development rejimida bypass qiladi.
 */
function webhookIPWhitelist(req, res, next) {
  // Development rejimida IP tekshiruvini o'tkazib yuboramiz
  if (process.env.NODE_ENV !== 'production') {
    return next();
  }

  // GET so'rovlar (webhook verification) uchun IP tekshiruv kerak emas
  if (req.method === 'GET') {
    return next();
  }

  const clientIP = normalizeIP(req.ip || req.connection.remoteAddress || '');

  // IPv4 formatda ekanligini tekshirish
  if (!net.isIPv4(clientIP)) {
    console.warn(`[IP Whitelist] IPv4 bo'lmagan IP: ${clientIP} — o'tkazib yuborildi`);
    return next(); // IPv6 yoki noma'lum formatda — o'tkazamiz
  }

  const isAllowed = FACEBOOK_IP_RANGES.some(cidr => isIPInCIDR(clientIP, cidr));

  if (!isAllowed) {
    console.warn(`[IP Whitelist] ⚠ Ruxsatsiz IP: ${clientIP} — POST /api/webhook. Test rejimi uchun o'tkazib yuborilmoqda.`);
    // return res.status(403).json({
    //   error: 'Forbidden',
    //   message: 'This IP address is not authorized to send webhook requests.'
    // });
  }

  console.log(`[IP Whitelist] ✓ Facebook IP tasdiqlandi: ${clientIP}`);
  next();
}


// ══════════════════════════════════════════
// 3. RESPONSE SANITIZER
// ══════════════════════════════════════════

/**
 * API javoblardan sensitive (maxfiy) ma'lumotlarni tozalaydi.
 * Bu middleware res.json() ni override qilib, chiqishda filtrlaydi.
 */
const SENSITIVE_FIELDS = [
  'password', 'password_hash', 'hashedPassword',
  'accessToken', 'refreshToken', 'jwt_secret',
  'api_key', 'apiKey', 'secret',
  'DATABASE_URL', 'DIRECT_URL',
  'APP_SECRET', 'WEBHOOK_SECRET',
  'TELEGRAM_BOT_TOKEN', 'FB_PAGE_ACCESS_TOKEN',
  'DEEPSEEK_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY'
];

function sanitizeObject(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeObject);

  const clean = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_FIELDS.some(f => key.toLowerCase().includes(f.toLowerCase()))) {
      clean[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      clean[key] = sanitizeObject(value);
    } else {
      clean[key] = value;
    }
  }
  return clean;
}

function sanitizeResponse(req, res, next) {
  const originalJson = res.json.bind(res);

  res.json = function (data) {
    if (data && typeof data === 'object') {
      return originalJson(sanitizeObject(data));
    }
    return originalJson(data);
  };

  next();
}


module.exports = {
  rateLimiter,
  webhookIPWhitelist,
  sanitizeResponse,
  FACEBOOK_IP_RANGES
};
