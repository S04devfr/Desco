const express = require('express');
const router = express.Router();
const { protect, requireRole } = require('../middleware/auth');
const prisma = require('../config/database');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');

// In-memory cache for active verification flows
// Key: clean phone number, Value: { client, phoneCodeHash, apiId, apiHash }
const activeLogins = {};

/**
 * GET /api/telegram/status
 * Connection status
 */
router.get('/status', protect, async (req, res) => {
  try {
    const settings = await prisma.companySettings.findFirst();
    if (settings && settings.telegramSessionString) {
      return res.json({
        connected: true,
        phone: settings.telegramPhone,
        apiId: settings.telegramApiId
      });
    }
    res.json({ connected: false });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/**
 * POST /api/telegram/send-code
 * Connects client and triggers OTP code SMS
 */
router.post('/send-code', protect, requireRole('admin'), async (req, res) => {
  try {
    const { phone, apiId, apiHash } = req.body;
    if (!phone || !apiId || !apiHash) {
      return res.status(400).json({ message: "Barcha maydonlarni to'ldiring (Telefon, API ID, API Hash)" });
    }

    const cleanPhone = phone.trim().replace(/\s+/g, '');
    const cleanApiId = Number(apiId);
    const cleanApiHash = apiHash.trim();

    if (isNaN(cleanApiId)) {
      return res.status(400).json({ message: "API ID faqat raqamlardan iborat bo'lishi kerak" });
    }

    // Clean up older active login for the same phone number if exists
    if (activeLogins[cleanPhone]) {
      try {
        await activeLogins[cleanPhone].client.disconnect();
      } catch (e) {}
      delete activeLogins[cleanPhone];
    }

    const session = new StringSession("");
    const client = new TelegramClient(session, cleanApiId, cleanApiHash, {
      connectionRetries: 5,
    });

    await client.connect();

    const { phoneCodeHash } = await client.sendCode(
      {
        apiId: cleanApiId,
        apiHash: cleanApiHash,
      },
      cleanPhone
    );

    activeLogins[cleanPhone] = {
      client,
      phoneCodeHash,
      apiId: cleanApiId,
      apiHash: cleanApiHash
    };

    res.json({ success: true, message: "Tasdiqlash kodi Telegram orqali yuborildi." });
  } catch (err) {
    console.error("[Telegram send-code error]:", err);
    res.status(500).json({ message: err.message || "Kod yuborishda xatolik yuz berdi" });
  }
});

/**
 * POST /api/telegram/verify-code
 * Signs in using the code, saves the session string and disconnects client
 */
router.post('/verify-code', protect, requireRole('admin'), async (req, res) => {
  try {
    const { phone, code } = req.body;
    if (!phone || !code) {
      return res.status(400).json({ message: "Telefon va tasdiqlash kodini kiritish majburiy" });
    }

    const cleanPhone = phone.trim().replace(/\s+/g, '');
    const cleanCode = code.trim();

    const loginData = activeLogins[cleanPhone];
    if (!loginData) {
      return res.status(400).json({ message: "Avval kod yuborish so'rovini boshlang" });
    }

    const { client, phoneCodeHash, apiId, apiHash } = loginData;

    const { Api } = require('telegram');
    await client.invoke(
      new Api.auth.SignIn({
        phoneNumber: cleanPhone,
        phoneCodeHash: phoneCodeHash,
        phoneCode: cleanCode
      })
    );

    const sessionString = client.session.save();

    await client.disconnect();
    delete activeLogins[cleanPhone];

    // Save credentials in settings
    const settings = await prisma.companySettings.findFirst();
    if (settings) {
      await prisma.companySettings.update({
        where: { id: settings.id },
        data: {
          telegramSessionString: sessionString,
          telegramPhone: cleanPhone,
          telegramApiId: String(apiId),
          telegramApiHash: apiHash
        }
      });
    } else {
      await prisma.companySettings.create({
        data: {
          companyName: 'DESCO CRM',
          currency: 'UZS',
          telegramSessionString: sessionString,
          telegramPhone: cleanPhone,
          telegramApiId: String(apiId),
          telegramApiHash: apiHash
        }
      });
    }

    res.json({ success: true, message: "Telegram akkaunti muvaffaqiyatli bog'landi!" });
  } catch (err) {
    console.error("[Telegram verify-code error]:", err);
    let msg = err.message || "Kodni tasdiqlashda xatolik yuz berdi";
    if (err.message && err.message.includes("SESSION_PASSWORD_NEEDED")) {
      msg = "Hisobingizda Ikki bosqichli parollash (2-FA) yoqilgan. Tizim sodda ulanishi uchun, iltimos, Telegram sozlamalaridan 2-bosqichli parolni vaqtinchalik o'chirib turing va qayta urinib ko'ring.";
    }
    res.status(500).json({ message: msg });
  }
});

/**
 * POST /api/telegram/disconnect
 * Disconnects and removes saved credentials
 */
router.post('/disconnect', protect, requireRole('admin'), async (req, res) => {
  try {
    const settings = await prisma.companySettings.findFirst();
    if (settings) {
      await prisma.companySettings.update({
        where: { id: settings.id },
        data: {
          telegramSessionString: null,
          telegramPhone: null,
          telegramApiId: null,
          telegramApiHash: null
        }
      });
    }
    res.json({ success: true, message: "Telegram akkaunti uzildi." });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
