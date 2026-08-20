/**
 * CSRF Himoyasi — Double-Submit Cookie Pattern
 * 
 * Bu middleware CSRF (Cross-Site Request Forgery) hujumlarini oldini oladi.
 * 
 * Ishlash tartibi:
 * 1. Har bir sessiya uchun unikal CSRF token generatsiya qilinadi
 * 2. Token cookie va response header orqali frontendga yuboriladi
 * 3. Mutating (POST/PUT/PATCH/DELETE) so'rovlarda token tekshiriladi
 * 4. API (Authorization header bilan) va webhook endpointlar bypass qilinadi
 */

const crypto = require('crypto');

// CSRF token generatsiya qilish
function generateCSRFToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * CSRF middleware
 * - GET/HEAD/OPTIONS so'rovlarda token beradi
 * - POST/PUT/PATCH/DELETE so'rovlarda token tekshiradi
 * - API endpointlar (JWT auth) va webhook'lar bypass
 */
function csrfProtection(req, res, next) {
  // Bypass: API so'rovlar (JWT Authorization header bilan)
  if (req.headers.authorization) {
    return next();
  }

  // Bypass: Webhook endpointlar
  if (req.path.startsWith('/api/webhook') || req.path.startsWith('/api/instagram/webhook')) {
    return next();
  }

  // Bypass: Wazzup webhook
  if (req.path.startsWith('/api/instagram/wazzup')) {
    return next();
  }

  // Bypass: Login va register (session yo'q bo'lganda)
  if (req.path === '/api/auth/login' || req.path === '/api/auth/register') {
    return next();
  }

  // Bypass: Public legal sahifalar
  if (req.path.startsWith('/privacy') || req.path.startsWith('/terms') || req.path.startsWith('/data-deletion')) {
    return next();
  }

  // Agar sessiya mavjud bo'lmasa — o'tkazib yuborish
  if (!req.session) {
    return next();
  }

  // Sessiyada CSRF token bo'lmasa — yaratish
  if (!req.session.csrfToken) {
    req.session.csrfToken = generateCSRFToken();
  }

  // Token ni cookie va response header orqali frontendga yuborish
  res.cookie('XSRF-TOKEN', req.session.csrfToken, {
    httpOnly: false, // Frontend JS o'qishi uchun
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/'
  });
  res.setHeader('X-CSRF-Token', req.session.csrfToken);

  // Safe methods — tekshirish kerak emas
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  // Mutating methodlar uchun CSRF token tekshiruvi
  const tokenFromHeader = req.headers['x-csrf-token'] || req.headers['x-xsrf-token'];
  const tokenFromBody = req.body?._csrf;
  const tokenFromQuery = req.query?._csrf;
  const clientToken = tokenFromHeader || tokenFromBody || tokenFromQuery;

  // Agar token kelmasa yoki mos kelmasa, lekin session autentifikatsiya qilingan bo'lsa
  if (!clientToken || clientToken !== req.session.csrfToken) {
    // XMLHttpRequest / fetch orqali kelgan ichki CRM so'rovlari uchun log qilish va o'tkazish
    const isAjax = req.xhr || req.headers['x-requested-with'] === 'XMLHttpRequest' || (req.headers.accept && req.headers.accept.includes('application/json'));
    if (!clientToken && isAjax && req.session.userId) {
      // Ichki ajax chaqiruvlarni bloklamasdan o'tkazamiz
      return next();
    }
    console.warn(`[CSRF] ⚠ Token mismatch: IP=${req.ip}, Path=${req.path}, Method=${req.method}`);
    return res.status(403).json({
      error: 'CSRF token yaroqsiz yoki topilmadi',
      message: 'Sahifani yangilab qayta urinib ko\'ring'
    });
  }

  next();
}

/**
 * EJS templatelar uchun CSRF token helper
 * res.locals.csrfToken ga token qo'shadi
 */
function csrfTokenProvider(req, res, next) {
  if (req.session) {
    if (!req.session.csrfToken) {
      req.session.csrfToken = generateCSRFToken();
    }
    res.locals.csrfToken = req.session.csrfToken;
  }
  next();
}

module.exports = { csrfProtection, csrfTokenProvider, generateCSRFToken };
