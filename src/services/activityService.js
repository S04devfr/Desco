const prisma = require('../config/database');

/**
 * Enterprise Activity & Operator Presence Engine (amoCRM / HubSpot Grade)
 */

function getTodayStr() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatTimeHHMM(date) {
  if (!date) return '—';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '—';
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * Record a heartbeat ping from user's client
 * @param {Object} params
 * @param {number} params.userId
 * @param {boolean} params.isIdle
 * @param {string} [params.action] - e.g. 'deal_edit', 'call', 'task_done'
 * @param {string} [params.ipAddress]
 * @param {string} [params.device]
 * @param {Function} [params.broadcast] - WebSocket broadcaster
 */
async function recordHeartbeat({ userId, isIdle = false, action = null, ipAddress = null, device = null, broadcast = null }) {
  if (!userId) return null;

  const today = getTodayStr();
  const now = new Date();
  const OFFLINE_CUTOFF_MS = 3 * 60 * 1000; // 3 min threshold to detect offline/disconnected

  try {
    let session = null;
    if (prisma.userSessionLog && typeof prisma.userSessionLog.findUnique === 'function') {
      session = await prisma.userSessionLog.findUnique({
        where: { userId_date: { userId: Number(userId), date: today } }
      }).catch(() => null);
    }

    let previousStatus = session ? session.status : 'offline';
    let newStatus = isIdle ? 'idle' : 'active';

    if (!session) {
      // First login of the day
      if (prisma.userSessionLog && typeof prisma.userSessionLog.create === 'function') {
        session = await prisma.userSessionLog.create({
          data: {
            userId: Number(userId),
            date: today,
            firstLogin: now,
            lastPing: now,
            activeSeconds: isIdle ? 0 : 30,
            idleSeconds: isIdle ? 30 : 0,
            status: newStatus,
            totalActions: action ? 1 : 0,
            ipAddress: ipAddress || null,
            device: device || null
          }
        }).catch(async () => {
          // Fallback in case raw SQL is needed
          try {
            await prisma.$executeRaw`
              INSERT INTO "user_session_logs" ("userId", "date", "firstLogin", "lastPing", "activeSeconds", "idleSeconds", "status", "totalActions", "ipAddress", "device", "createdAt", "updatedAt")
              VALUES (${Number(userId)}, ${today}, ${now}, ${now}, ${isIdle ? 0 : 30}, ${isIdle ? 30 : 0}, ${newStatus}, ${action ? 1 : 0}, ${ipAddress}, ${device}, ${now}, ${now})
              ON CONFLICT ("userId", "date") DO UPDATE SET "lastPing" = ${now}, "status" = ${newStatus}
            `;
            if (prisma.userSessionLog && typeof prisma.userSessionLog.findUnique === 'function') {
              return prisma.userSessionLog.findUnique({ where: { userId_date: { userId: Number(userId), date: today } } }).catch(() => null);
            }
            return null;
          } catch (e) {
            return null;
          }
        });
      }
    } else {
      // Calculate delta seconds since last ping (clamped between 1s and 120s to handle sleep/wake)
      const lastPingTime = new Date(session.lastPing).getTime();
      const elapsedMs = Math.max(0, now.getTime() - lastPingTime);
      let deltaSeconds = Math.min(120, Math.max(1, Math.round(elapsedMs / 1000)));

      // If gap was larger than 10 minutes (e.g. computer was turned off / deep sleep), don't inflate time
      if (elapsedMs > 10 * 60 * 1000) {
        deltaSeconds = 30; // standard 1 ping credit
      }

      const activeIncrement = isIdle ? 0 : deltaSeconds;
      const idleIncrement = isIdle ? deltaSeconds : 0;
      const actionIncrement = action ? 1 : 0;

      if (prisma.userSessionLog && typeof prisma.userSessionLog.update === 'function') {
        session = await prisma.userSessionLog.update({
          where: { id: session.id },
          data: {
            lastPing: now,
            status: newStatus,
            activeSeconds: { increment: activeIncrement },
            idleSeconds: { increment: idleIncrement },
            totalActions: { increment: actionIncrement },
            ipAddress: ipAddress || session.ipAddress,
            device: device || session.device
          }
        }).catch(async () => {
          try {
            await prisma.$executeRaw`
              UPDATE "user_session_logs"
              SET "lastPing" = ${now},
                  "status" = ${newStatus},
                  "activeSeconds" = "activeSeconds" + ${activeIncrement},
                  "idleSeconds" = "idleSeconds" + ${idleIncrement},
                  "totalActions" = "totalActions" + ${actionIncrement},
                  "ipAddress" = COALESCE(${ipAddress}, "ipAddress"),
                  "device" = COALESCE(${device}, "device"),
                  "updatedAt" = ${now}
              WHERE "id" = ${session.id}
            `;
            return {
              ...session,
              lastPing: now,
              status: newStatus,
              activeSeconds: session.activeSeconds + activeIncrement,
              idleSeconds: session.idleSeconds + idleIncrement
            };
          } catch (e) {
            return session;
          }
        });
      }
    }

    // Broadcast if status transitioned (e.g. offline -> online, active -> idle)
    if (broadcast && previousStatus !== newStatus) {
      broadcast({
        type: 'operator_presence_change',
        userId: Number(userId),
        status: newStatus,
        timestamp: now.toISOString()
      });
    }

    return session;
  } catch (err) {
    console.error('[ActivityService Heartbeat Error]', err.message);
    return null;
  }
}

/**
 * Get real-time Operator Presence & Activity Metrics for all managers
 */
async function getLiveOperatorPresence() {
  const today = getTodayStr();
  const OFFLINE_THRESHOLD_MS = 3.5 * 60 * 1000; // > 3.5 mins without ping = offline
  const now = Date.now();

  try {
    // 1. Get all active staff users (managers, operators, admins if needed)
    const managers = await prisma.user.findMany({
      where: { isActive: true },
      select: {
        id: true,
        fullName: true,
        name: true,
        email: true,
        role: true,
        avatar: true,
        createdAt: true
      },
      orderBy: [{ role: 'asc' }, { fullName: 'asc' }]
    }).catch(() => []);

    // 2. Fetch today's session logs for all users
    let sessionLogs = [];
    try {
      sessionLogs = await prisma.userSessionLog.findMany({
        where: { date: today }
      });
    } catch (e) {
      // Raw fallback
      try {
        sessionLogs = await prisma.$queryRaw`
          SELECT * FROM "user_session_logs" WHERE "date" = ${today}
        `;
      } catch (rawErr) {
        sessionLogs = [];
      }
    }

    const sessionMap = new Map();
    sessionLogs.forEach(s => sessionMap.set(Number(s.userId), s));

    let totalActive = 0;
    let totalIdle = 0;
    let totalOffline = 0;
    let totalOnlineSec = 0;

    const operators = managers.map(m => {
      const sess = sessionMap.get(Number(m.id));
      const displayName = m.fullName || m.name || m.email.split('@')[0];
      const roleLabel = m.role === 'admin' ? 'Administrator' : m.role === 'operator' ? 'Operator' : 'Sotuv menejeri';

      if (!sess) {
        // No session today -> 100% Offline
        totalOffline++;
        return {
          id: m.id,
          name: displayName,
          role: roleLabel,
          avatar: m.avatar,
          status: 'offline',
          statusText: '⚪ Offline',
          firstLoginTime: '—',
          onlineSec: 0,
          activeSec: 0,
          idleSec: 0,
          activeWorkRatio: 0,
          totalActions: 0,
          lastPing: null
        };
      }

      // Check if ping is recent
      const lastPingTime = new Date(sess.lastPing).getTime();
      const isPingRecent = (now - lastPingTime) <= OFFLINE_THRESHOLD_MS;

      let resolvedStatus = 'offline';
      let resolvedStatusText = '⚪ Offline';

      if (isPingRecent) {
        if (sess.status === 'idle') {
          resolvedStatus = 'idle';
          resolvedStatusText = '🟡 Tanaffusda';
          totalIdle++;
        } else {
          resolvedStatus = 'active';
          resolvedStatusText = '🟢 Aktiv';
          totalActive++;
        }
      } else {
        totalOffline++;
      }

      const activeSec = Number(sess.activeSeconds || 0);
      const idleSec = Number(sess.idleSeconds || 0);
      const onlineSec = activeSec + idleSec;

      totalOnlineSec += onlineSec;

      // Activity Index calculation:
      // Ratio of active work time vs total online time + action bonus
      let activeWorkRatio = 0;
      if (onlineSec > 0) {
        activeWorkRatio = Math.min(100, Math.max(10, Math.round((activeSec / onlineSec) * 100)));
      }

      return {
        id: m.id,
        name: displayName,
        role: roleLabel,
        avatar: m.avatar,
        status: resolvedStatus,
        statusText: resolvedStatusText,
        firstLoginTime: formatTimeHHMM(sess.firstLogin),
        onlineSec,
        activeSec,
        idleSec,
        activeWorkRatio,
        totalActions: Number(sess.totalActions || 0),
        lastPing: sess.lastPing
      };
    });

    // Sort: Online first (Active -> Idle), then by online duration descending
    operators.sort((a, b) => {
      const statusWeight = { active: 3, idle: 2, offline: 1 };
      if (statusWeight[b.status] !== statusWeight[a.status]) {
        return statusWeight[b.status] - statusWeight[a.status];
      }
      return b.onlineSec - a.onlineSec;
    });

    return {
      summary: {
        totalActive,
        totalIdle,
        totalOffline,
        totalOnlineSec,
        date: today
      },
      operators
    };
  } catch (err) {
    console.error('[getLiveOperatorPresence Error]', err);
    return {
      summary: { totalActive: 0, totalIdle: 0, totalOffline: 0, totalOnlineSec: 0, date: today },
      operators: []
    };
  }
}

module.exports = {
  recordHeartbeat,
  getLiveOperatorPresence,
  getTodayStr,
  formatTimeHHMM
};
