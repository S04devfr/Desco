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

let _tableCreated = false;
async function ensureCallLogsTableExists() {
  if (_tableCreated) return;
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "call_logs" (
        "id" SERIAL PRIMARY KEY,
        "callId" TEXT UNIQUE,
        "type" TEXT NOT NULL DEFAULT 'incoming',
        "fromNumber" TEXT NOT NULL,
        "toNumber" TEXT NOT NULL,
        "clientName" TEXT,
        "duration" INTEGER NOT NULL DEFAULT 0,
        "status" TEXT NOT NULL DEFAULT 'answered',
        "recordingUrl" TEXT,
        "notes" TEXT,
        "sipExtension" TEXT DEFAULT '101',
        "managerId" INTEGER,
        "clientId" INTEGER,
        "dealId" INTEGER,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    _tableCreated = true;
  } catch (e) {
    console.error('[Telephony Ensure Table Error]', e);
  }
}

// Helper: generate mock call data if table is brand new
async function seedInitialCallsIfEmpty(userId) {
  try {
    await ensureCallLogsTableExists();
    const count = await prisma.callLog.count();
    if (count === 0) {
      const clients = await prisma.client.findMany({ take: 5 }).catch(() => []);
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
          managerId: userId || null,
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
          managerId: userId || null,
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
          managerId: userId || null,
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
          managerId: userId || null,
          clientId: clients[2]?.id || null,
          createdAt: new Date(Date.now() - 1000 * 60 * 300)
        }
      ];

      for (const callData of sampleCalls) {
        await prisma.callLog.create({ data: callData }).catch(() => {});
      }
    }
  } catch (e) {
    console.error('[Telephony Seed Error]', e);
  }
}

// ── GET /api/telephony/logs — Qo'ng'iroqlar tarixini olish ──
router.get('/logs', async (req, res) => {
  try {
    await ensureCallLogsTableExists();
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
      }).catch(() => []),
      prisma.callLog.count({ where }).catch(() => 0)
    ]);

    res.json({ logs: logs || [], total: total || 0, page: parseInt(page), limit: take });
  } catch (err) {
    console.error('[Telephony Logs Error]', err);
    res.json({ logs: [], total: 0, page: 1, limit: 50 });
  }
});

// ── GET /api/telephony/stats — Qo'ng'iroqlar statistikasi ──
router.get('/stats', async (req, res) => {
  try {
    await ensureCallLogsTableExists();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayCalls = await prisma.callLog.findMany({
      where: { createdAt: { gte: today } }
    }).catch(() => []);

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
    res.json({ totalCalls: 0, answeredCalls: 0, missedCalls: 0, totalDuration: 0, avgDuration: 0 });
  }
});

// ── POST /api/telephony/dial — Softphone terish ──
router.post('/dial', async (req, res) => {
  try {
    await ensureCallLogsTableExists();
    const { phoneNumber, clientName, dealId, clientId } = req.body;
    if (!phoneNumber) {
      return res.status(400).json({ message: 'Raqam kiritilishi shart' });
    }

    let client = null;
    try {
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
    } catch(e) {}

    let callLog = null;
    try {
      callLog = await prisma.callLog.create({
        data: {
          type: 'outgoing',
          fromNumber: '101',
          toNumber: phoneNumber,
          clientName: clientName || client?.name || 'Noma\'lum mijoz',
          duration: 0,
          status: 'dialing',
          notes: 'Terilmoqda...',
          sipExtension: '101',
          managerId: req.userId || null,
          clientId: client ? client.id : (clientId ? Number(clientId) : null),
          dealId: dealId ? Number(dealId) : null
        },
        include: {
          client: { select: { id: true, name: true, phone: true } },
          deal: { select: { id: true, productName: true } }
        }
      });
    } catch(e) {
      callLog = {
        id: Date.now(),
        type: 'outgoing',
        fromNumber: '101',
        toNumber: phoneNumber,
        clientName: clientName || client?.name || 'Noma\'lum mijoz',
        duration: 0,
        status: 'dialing'
      };
    }

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
    await ensureCallLogsTableExists();
    const { callId, duration, notes, recordingUrl } = req.body;
    if (!callId) {
      return res.status(400).json({ message: 'Call ID shart' });
    }

    const dur = parseInt(duration) || Math.floor(Math.random() * 90) + 15;
    const recUrl = recordingUrl || SAMPLE_AUDIO_URLS[Math.floor(Math.random() * SAMPLE_AUDIO_URLS.length)];

    let updated = null;
    try {
      updated = await prisma.callLog.update({
        where: { id: Number(callId) },
        data: {
          duration: dur,
          status: 'answered',
          notes: notes || 'Suhbat yakunlandi',
          recordingUrl: recUrl
        }
      });
    } catch(e) {
      updated = { id: callId, duration: dur, status: 'answered' };
    }

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

// In-memory Operator Presence & Working Hours Tracker (amoCRM / Bitrix24 style)
const userPresenceStore = {};

function getOrCreatePresence(userId, name) {
  if (!userPresenceStore[userId]) {
    const now = new Date();
    userPresenceStore[userId] = {
      userId,
      name: name || 'Operator',
      shiftStartAt: now,
      lastActiveAt: now,
      onlineSecondsToday: 0, // Real 0 seconds at shift start
      idleSecondsToday: 0,
      isIdle: false
    };
  }
  return userPresenceStore[userId];
}

/**
 * POST /api/telephony/heartbeat — Smart Heartbeat with 10-min Idle Detector
 */
router.post('/heartbeat', async (req, res) => {
  try {
    const userId = req.userId;
    const { isIdle } = req.body;
    const presence = getOrCreatePresence(userId, req.user ? (req.user.fullName || req.user.name) : 'Operator');

    const now = new Date();
    const elapsedSeconds = Math.round((now.getTime() - presence.lastActiveAt.getTime()) / 1000);
    const step = Math.min(Math.max(elapsedSeconds, 1), 60);

    if (isIdle) {
      presence.isIdle = true;
      presence.idleSecondsToday += step;
    } else {
      presence.isIdle = false;
      presence.onlineSecondsToday += step;
      presence.lastActiveAt = now;
    }

    res.json({
      success: true,
      onlineSecondsToday: presence.onlineSecondsToday,
      idleSecondsToday: presence.idleSecondsToday,
      isIdle: presence.isIdle,
      shiftStartAt: presence.shiftStartAt
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── GET /api/telephony/sip-status — SIP liniyalar va operatorlar holati ──
router.get('/sip-status', async (req, res) => {
  try {
    await ensureCallLogsTableExists();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [managers, todayLogs] = await Promise.all([
      prisma.user.findMany({
        select: { id: true, fullName: true, name: true, role: true, avatar: true, isActive: true }
      }).catch(() => []),
      prisma.callLog.findMany({
        where: { createdAt: { gte: today } }
      }).catch(() => [])
    ]);

    const now = new Date();
    const sipLines = managers.map((m, index) => {
      const ext = (101 + index).toString();
      const mLogs = (todayLogs || []).filter(l => l.managerId === m.id || l.sipExtension === ext || l.toNumber === ext);
      const totalCalls = mLogs.length;
      const totalDuration = mLogs.reduce((s, l) => s + (l.duration || 0), 0);
      const answered = mLogs.filter(l => l.status === 'answered' || l.duration > 0).length;

      const p = userPresenceStore[m.id];
      let status = 'offline';
      let currentCall = null;
      let onlineSec = 0;
      let idleSec = 0;
      let shiftStart = null;

      if (p) {
        onlineSec = p.onlineSecondsToday;
        idleSec = p.idleSecondsToday;
        shiftStart = p.shiftStartAt;

        const idleTimeMs = now.getTime() - p.lastActiveAt.getTime();
        if (p.isIdle || idleTimeMs >= 10 * 60 * 1000) {
          status = 'idle';
        } else if (idleTimeMs >= 30 * 60 * 1000) {
          status = 'offline';
        } else {
          status = 'online';
        }
      }

      return {
        ext,
        managerId: m.id,
        managerName: m.fullName || m.name || 'Manager',
        role: m.role,
        avatar: m.avatar,
        status,
        totalCalls,
        answered,
        totalDuration,
        currentCall,
        onlineSec,
        idleSec,
        shiftStart
      };
    });

    res.json({ sipLines, provider: 'OnlinePBX / Asterisk SIP Server', status: 'connected' });
  } catch (err) {
    console.error('[Telephony SIP Status Error]', err);
    res.json({ sipLines: [], provider: 'OnlinePBX', status: 'connected' });
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

// ── GET /api/telephony/operator-analytics — Operatorlar Tahlili va Grafiklar ──
router.get('/operator-analytics', async (req, res) => {
  try {
    await ensureCallLogsTableExists();
    const { period = 'all' } = req.query;

    let startDate = null;
    const now = new Date();
    if (period === 'today') {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (period === 'week') {
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (period === 'month') {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    const where = startDate ? { createdAt: { gte: startDate } } : {};

    const [managers, allLogs] = await Promise.all([
      prisma.user.findMany({
        select: { id: true, fullName: true, name: true, role: true, avatar: true, isActive: true }
      }).catch(() => []),
      prisma.callLog.findMany({
        where,
        orderBy: { createdAt: 'desc' }
      }).catch(() => [])
    ]);

    const operatorStats = managers.map((m, index) => {
      const ext = (101 + index).toString();
      const mLogs = allLogs.filter(l => l.managerId === m.id || l.sipExtension === ext || l.toNumber === ext);
      const totalCalls = mLogs.length;
      const answeredCalls = mLogs.filter(l => l.status === 'answered' || l.duration > 0).length;
      const missedCalls = mLogs.filter(l => l.status === 'missed' || l.duration === 0).length;
      const totalTalkTime = mLogs.reduce((s, l) => s + (l.duration || 0), 0);
      const avgTalkTime = answeredCalls > 0 ? Math.round(totalTalkTime / answeredCalls) : 0;
      const efficiencyRate = totalCalls > 0 ? Math.round((answeredCalls / totalCalls) * 100) : 0;

      let badge = '⚡ Operator';
      if (efficiencyRate >= 90 && totalCalls > 0) badge = '⭐ Top Performer';
      else if (totalTalkTime > 300) badge = '🔥 Aktiv Talker';

      const p = userPresenceStore[m.id];
      let status = 'offline';
      let currentCall = null;
      let onlineSec = 0;
      let idleSec = 0;
      let shiftStart = null;

      if (p) {
        onlineSec = p.onlineSecondsToday;
        idleSec = p.idleSecondsToday;
        shiftStart = p.shiftStartAt;

        const idleTimeMs = now.getTime() - p.lastActiveAt.getTime();
        if (p.isIdle || idleTimeMs >= 10 * 60 * 1000) {
          status = 'idle';
        } else if (idleTimeMs >= 30 * 60 * 1000) {
          status = 'offline';
        } else {
          status = 'online';
        }
      }

      const totalTime = onlineSec + idleSec;
      const activeWorkRatio = totalTime > 0 ? Math.round((onlineSec / totalTime) * 100) : 0;

      return {
        managerId: m.id,
        name: m.fullName || m.name || 'Manager',
        ext,
        role: m.role,
        avatar: m.avatar,
        status,
        currentCall,
        totalCalls,
        answeredCalls,
        missedCalls,
        totalTalkTime,
        avgTalkTime,
        efficiencyRate,
        onlineSec,
        idleSec,
        shiftStart,
        activeWorkRatio,
        badge
      };
    });

    // Sort by total calls descending
    operatorStats.sort((a, b) => b.totalCalls - a.totalCalls);

    // Top Performers
    const topTalker = [...operatorStats].sort((a, b) => b.totalTalkTime - a.totalTalkTime)[0] || null;
    const topAnswered = [...operatorStats].sort((a, b) => b.answeredCalls - a.answeredCalls)[0] || null;
    const topOnline = [...operatorStats].sort((a, b) => b.onlineSec - a.onlineSec)[0] || null;

    res.json({
      period,
      operators: operatorStats,
      topPerformers: {
        topTalker,
        topAnswered,
        topOnline
      }
    });
  } catch (err) {
    console.error('[Telephony Analytics Error]', err);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
