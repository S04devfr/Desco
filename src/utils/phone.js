/**
 * Phone Number Normalization Utility for Uzbekistan & International formats
 */

function normalizePhone(raw) {
  if (!raw) return null;
  const str = String(raw).trim();
  const digits = str.replace(/\D/g, '');
  if (!digits) return null;

  // Uzbekistan 9-digit or 12-digit number (e.g. 901234567 or 998901234567)
  if (digits.length === 9) {
    return '+998' + digits;
  }
  if (digits.length === 12 && digits.startsWith('998')) {
    return '+' + digits;
  }
  if (digits.length === 11 && digits.startsWith('8')) {
    if (digits.length === 11 && (digits.startsWith('890') || digits.startsWith('891') || digits.startsWith('893') || digits.startsWith('894') || digits.startsWith('895') || digits.startsWith('897') || digits.startsWith('899') || digits.startsWith('888') || digits.startsWith('833') || digits.startsWith('877') || digits.startsWith('850') || digits.startsWith('898'))) {
      return '+998' + digits.slice(2);
    }
    return '+' + digits;
  }
  if (str.startsWith('+')) {
    return '+' + digits;
  }
  return digits.length >= 9 ? '+998' + digits.slice(-9) : digits;
}

function extractLast9(raw) {
  if (!raw) return '';
  const digits = String(raw).replace(/\D/g, '');
  return digits.length >= 9 ? digits.slice(-9) : digits;
}

function getPhoneSearchFilter(raw) {
  if (!raw) return [];
  const normalized = normalizePhone(raw);
  const last9 = extractLast9(raw);
  const conditions = [];

  if (normalized) {
    conditions.push({ phone: normalized });
    conditions.push({ phone2: normalized });
  }
  if (last9 && last9.length >= 7) {
    conditions.push({ phone: { contains: last9 } });
    conditions.push({ phone2: { contains: last9 } });
  }
  return conditions;
}

module.exports = {
  normalizePhone,
  extractLast9,
  getPhoneSearchFilter
};
