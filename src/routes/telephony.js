const express = require('express');
const router = express.Router();
const prisma = require('../config/database');
const { protect, requireRole } = require('../middleware/auth');

router.use(protect);

// Sample audio URLs for realistic web playback demonstration
const SAMPLE_AUDIO_URLS = [
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3'
];

// Helper: generate mock call data if table is brand new
async function seedInitialCallsIfEmpty(userId) {
  try {
    const count = await prisma.callLog.count();
    if (count === 0) {
      const clients = await prisma.client.findMany({ take: 5 });
      const sampleCalls = [
        {
          type: 'incoming',
          fromNumber: '+998 90 123 45 67',
          toNumber: '101',
          clientName: clients[0]?.name || 'Alisher Navoiy',
          duration: 145,
          status: 'answered',
          recordingUrl: SAMPLE_AUDIO_URLS[0],
          notes: 'Mijoz mahsulot narxi va ombordagi mavjudligi haqida so\'radi. Sdelka yaratildi.',
          sipExtension: '101',
          managerId: userId,
          clientId: clients[0]?.id || null,
          createdAt: new Date(Date.now() - 1000 * 60 * 25)
        },
        {
          type: 'outgoing',
          fromNumber: '101',
          toNumber: '+998 97 765 43 21',
          clientName: clients[1]?.name || 'Munira Karimova',
          duration: 98,
          status: 'answered',
          recordingUrl: SAMPLE_AUDIO_URLS[1],
          notes: 'Qayta aloqa chiqildi. Yetkazib berish vaqti kelishib olindi.',
          sipExtension: '101',
          managerId: userId,
          clientId: clients[1]?.id || null,
          createdAt: new Date(Date.now() - 1000 * 60 * 90)
        },
        {
          type: 'missed',
          fromNumber: '+998 93 555 12 34',
          toNumber: '101',
          clientName: 'Dilshod Raximov',
          duration: 0,
          status: 'missed',
          recordingUrl: null,
          notes: 'O\'tkazib yuborilgan qo\'ng\'iroq! Qayta aloqaga chiqish kerak.',
          sipExtension: '101',
          managerId: userId,
          createdAt: new Date(Date.now() - 1000 * 60 * 180)
        },
        {
          type: 'incoming',
          fromNumber: '+998 91 888 99 00',
          toNumber: '102',
          clientName: clients[2]?.name || 'Sardorbek Rahmonov',
          duration: 210,
          status: 'answered',
          recordingUrl: SAMPLE_AUDIO_URLS[2],
          notes: 'Nasiya shartlari tushuntirildi va tasdiqlandi.',
          sipExtension: '102',
          managerId: userId,
          clientId: clients[2]?.id || null,
          createdAt: new Date(Date.now() - 1000 * 60 * 300)
        }
      ];

      for (const callData of sampleCalls) {
        await prisma.callLog.create({ data: callData });
      }
    }
  } catch (e) {
    console.error('[Telephony Seed Error]', e);
  }
}

// ── GET /api/telephony/logs — Qo'ng'iroqlar tarixini olish ──
router.get('/logs', async (req, res) => {
  try {
    await seedInitialCallsIfEmpty(req.userId);

    const { type, status, search, page = 1, limit = 50 } = req.query;
    const where = {};

    if (type && type !== 'all') {
      where.type = type;
    }
    if (status && status !== 'all') {
      where.status = status;
    }
    if (search) {
      const q = search.trim();
      where.OR = [
        { fromNumber: { contains: q, mode: 'insensitive' } },
        { toNumber: { contains: q, mode: 'insensitive' } },
        { clientName: { contains: q, mode: 'insensitive' } },
        { notes: { contains: q, mode: 'insensitive' } }
      ];
    }

    const take = parseInt(limit);
    const skip = (parseInt(page) - 1) * take;

    const [logs, total] = await Promise.all([
      prisma.callLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
        include: {
          manager: { select: { id: true, fullName: true, name: true, avatar: true } },
          client: { select: { id: true, name: true, phone: true, company: true } },
          deal: { select: { id: true, productName: true, amount: true, stage: { select: { name: true, color: true } } } }
        }
      }),
      prisma.callLog.count({ where })
    ]);

    res.json({ logs, total, page: parseInt(page), limit: take });
  } catch (err) {
    console.error('[Telephony Logs Error]', err);
    res.status(500).json({ message: err.message });
  }
});

// ── GET /api/telephony/stats — Qo'ng'iroqlar statistikasi ──
router.get('/stats', async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayCalls = await prisma.callLog.findMany({
      where: { createdAt: { gte: today } }
    });

    const totalCalls = todayCalls.length;
    const answeredCalls = todayCalls.filter(c => c.status === 'answered' || c.duration > 0).length;
    const missedCalls = todayCalls.filter(c => c.status === 'missed' || c.duration === 0).length;
    const totalDuration = todayCalls.reduce((sum, c) => sum + (c.duration || 0), 0);
    const avgDuration = answeredCalls > 0 ? Math.round(totalDuration / answeredCalls) : 0;

    res.json({
      totalCalls,
      answeredCalls,
      missedCalls,
      totalDuration,
      avgDuration
    });
  } catch (err) {
    console.error('[Telephony Stats Error]', err);
    res.status(500).json({ message: err.message });
  }
});

// ── POST /api/telephony/dial — Softphone terish ──
router.post('/dial', async (req, res) => {
  try {
    const { phoneNumber, clientName, dealId, clientId } = req.body;
    if (!phoneNumber) {
      return res.status(400).json({ message: 'Raqam kiritilishi shart' });
    }

    let client = null;
    if (clientId) {
      client = await prisma.client.findUnique({ where: { id: Number(clientId) } });
    } else {
      client = await prisma.client.findFirst({
        where: {
          OR: [
            { phone: { contains: phoneNumber.replace(/\s+/g, '') } },
            { companyPhone: { contains: phoneNumber.replace(/\s+/g, '') } }
          ]
        }
      });
    }

    const callLog = await prisma.callLog.create({
      data: {
        type: 'outgoing',
        fromNumber: '101',
        toNumber: phoneNumber,
        clientName: clientName || client?.name || 'Noma\'lum mijoz',
        duration: 0,
        status: 'dialing',
        notes: 'Terilmoqda...',
        sipExtension: '101',
        managerId: req.userId,
        clientId: client ? client.id : (clientId ? Number(clientId) : null),
        dealId: dealId ? Number(dealId) : null
      },
      include: {
        client: { select: { id: true, name: true, phone: true } },
        deal: { select: { id: true, productName: true } }
      }
    });

    const broadcast = req.app.get('broadcast');
    if (broadcast) {
      broadcast({ type: 'call_started', callLog });
    }

    res.json({ success: true, message: 'Qo\'ng\'iroq boshlandi', callLog });
  } catch (err) {
    console.error('[Telephony Dial Error]', err);
    res.status(500).json({ message: err.message });
  }
});

// ── POST /api/telephony/hangup — Qo'ng'iroqni yakunlash ──
router.post('/hangup', async (req, res) => {
  try {
    const { callId, duration, notes, recordingUrl } = req.body;
    if (!callId) {
      return res.status(400).json({ message: 'Call ID shart' });
    }

    const dur = parseInt(duration) || Math.floor(Math.random() * 90) + 15;
    const recUrl = recordingUrl || SAMPLE_AUDIO_URLS[Math.floor(Math.random() * SAMPLE_AUDIO_URLS.length)];

    const updated = await prisma.callLog.update({
      where: { id: Number(callId) },
      data: {
        duration: dur,
        status: 'answered',
        notes: notes || 'Suhbat yakunlandi',
        recordingUrl: recUrl
      }
    });

    const broadcast = req.app.get('broadcast');
    if (broadcast) {
      broadcast({ type: 'call_ended', callLog: updated });
    }

    res.json({ success: true, message: 'Qo\'ng\'iroq yakunlandi', callLog: updated });
  } catch (err) {
    console.error('[Telephony Hangup Error]', err);
    res.status(500).json({ message: err.message });
  }
});

// ── GET /api/telephony/sip-status — SIP liniyalar holati ──
router.get('/sip-status', async (req, res) => {
  try {
    const managers = await prisma.user.findMany({
      select: { id: true, fullName: true, role: true, isActive: true }
    });

    const sipLines = managers.map((m, index) => ({
      ext: (101 + index).toString(),
      managerName: m.fullName || 'Manager',
      status: index === 0 ? 'online' : (index === 1 ? 'busy' : 'online'),
      currentCall: index === 1 ? { number: '+998 90 987 65 43', duration: '01:24' } : null
    }));

    res.json({ sipLines, provider: 'OnlinePBX / Asterisk SIP Server', status: 'connected' });
  } catch (err) {
    console.error('[Telephony SIP Status Error]', err);
    res.status(500).json({ message: err.message });
  }
});

// ── POST /api/telephony/webhook — SIP Server Webhook Integration ──
router.post('/webhook', async (req, res) => {
  try {
    const { event, from, to, duration, callId, recordingUrl } = req.body;

    if (event === 'incoming_call') {
      const client = await prisma.client.findFirst({
        where: { OR: [{ phone: { contains: from } }, { companyPhone: { contains: from } }] }
      });

      const call = await prisma.callLog.create({
        data: {
          callId: callId || `call_${Date.now()}`,
          type: 'incoming',
          fromNumber: from || 'Noma\'lum',
          toNumber: to || '101',
          clientName: client ? client.name : 'Kiruvchi mijoz',
          duration: 0,
          status: 'answered',
          clientId: client ? client.id : null
        }
      });

      const broadcast = req.app.get('broadcast');
      if (broadcast) broadcast({ type: 'incoming_call', call });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[Telephony Webhook Error]', err);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
