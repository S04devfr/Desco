const leadService = require('./src/services/leadService');

const payload = {
  "Source": "INSTAGRAM",
  "Ad Name": "oybek aka",
  "Full name": "Umidjon Muminov",
  "Ad Set Name": "hadiya biznes",
  "Kim uchun xarid qilmoqchisiz?": "sovg'a_uchun",
  "Qayerga yetkazib berish kerak?": "Нархи канча",
  "Telefon raqamingiz (Iltimos ishlaydigan raqamizi yozing)": "998555822"
};

const parsed = leadService.parseLeadPayload('make', payload);
console.log("Parsed leadId:", parsed.leadId);
if (parsed.leadId !== null) {
  console.log("✗ BUG FOUND: leadId is not null!");
} else {
  console.log("✓ SUCCESS: leadId is null");
}
