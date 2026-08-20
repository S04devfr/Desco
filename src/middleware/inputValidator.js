/**
 * Input Validator & Sanitizer — Centralized input security
 * 
 * 1. sanitizeInput — HTML/script injection tozalash
 * 2. validateId — :id parametrlarni tekshirish
 * 3. validatePagination — page/limit sanitization
 */

/**
 * Xavfli HTML/script belgilarni tozalaydi
 * @param {string} str — tozalanadigan satr
 * @returns {string} — xavfsiz satr
 */
function sanitizeString(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

/**
 * Ob'ektni rekursiv tozalash
 */
function sanitizeObject(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return sanitizeString(obj);
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeObject);

  const clean = {};
  for (const [key, value] of Object.entries(obj)) {
    // Key ni ham tozalash (prototype pollution oldini olish)
    const safeKey = sanitizeString(key);
    if (safeKey === '__proto__' || safeKey === 'constructor' || safeKey === 'prototype') continue;
    clean[safeKey] = sanitizeObject(value);
  }
  return clean;
}

/**
 * :id parametrini tekshirish middleware
 * Faqat raqamli ID qabul qiladi (SQL injection oldini olish)
 */
function validateId(req, res, next) {
  const id = req.params.id;
  if (id !== undefined) {
    const numId = Number(id);
    if (!Number.isInteger(numId) || numId < 1 || numId > 2147483647) {
      return res.status(400).json({ error: 'Yaroqsiz ID formati' });
    }
    req.params.id = String(numId); // Normalized
  }
  next();
}

/**
 * Pagination parametrlarini xavfsiz qilish
 */
function validatePagination(req, res, next) {
  if (req.query.page) {
    const page = Number(req.query.page);
    req.query.page = (Number.isInteger(page) && page > 0) ? page : 1;
  }
  if (req.query.limit) {
    const limit = Number(req.query.limit);
    req.query.limit = (Number.isInteger(limit) && limit > 0 && limit <= 200) ? limit : 50;
  }
  next();
}

/**
 * Prototype pollution himoyasi
 * __proto__, constructor, prototype kalitlarini body/query/params dan olib tashlaydi
 */
function antiPrototypePollution(req, res, next) {
  const dangerous = ['__proto__', 'constructor', 'prototype'];
  
  function clean(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    for (const key of dangerous) {
      if (key in obj) delete obj[key];
    }
    for (const value of Object.values(obj)) {
      if (value && typeof value === 'object') clean(value);
    }
    return obj;
  }

  if (req.body) clean(req.body);
  if (req.query) clean(req.query);
  if (req.params) clean(req.params);
  
  next();
}

module.exports = {
  sanitizeString,
  sanitizeObject,
  validateId,
  validatePagination,
  antiPrototypePollution
};
