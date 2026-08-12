const webPush = require('web-push');
const prisma = require('../config/database');

// Configure VAPID keys
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || 'BEl62iUYgUivxIkv69yViEuiBIa1F-6G52G8w-1_4Y6eW6e8z8t_6V_pW4w4w4w4w4w4w4w4w4w4w4w4w4w';
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || 'uW4w4w4w4w4w4w4w4w4w4w4w4w4w4w4w4w4w4w4w4w0';

try {
  webPush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:admin@desco.uz',
    vapidPublicKey,
    vapidPrivateKey
  );
} catch (e) {
  // If invalid mock key in dev, auto-generate standard keypair
  const keys = webPush.generateVAPIDKeys();
  webPush.setVapidDetails('mailto:admin@desco.uz', keys.publicKey, keys.privateKey);
}

// 1. Store push subscription for user
async function saveSubscription(userId, subscription, userAgent) {
  try {
    const endpoint = subscription.endpoint;
    const keysStr = JSON.stringify(subscription.keys || {});

    const existing = await prisma.pushSubscription.findUnique({ where: { endpoint } });
    if (existing) {
      return await prisma.pushSubscription.update({
        where: { endpoint },
        data: { userId: Number(userId), keys: keysStr, userAgent }
      });
    }

    return await prisma.pushSubscription.create({
      data: {
        endpoint,
        keys: keysStr,
        userId: Number(userId),
        userAgent
      }
    });
  } catch (err) {
    console.error('[Push Save Error]:', err.message);
    throw err;
  }
}

// 2. Send push notification to specific user
async function sendPushToUser(userId, notificationPayload) {
  try {
    const subs = await prisma.pushSubscription.findMany({
      where: { userId: Number(userId) }
    });

    if (subs.length === 0) return { count: 0 };

    const payload = JSON.stringify({
      title: notificationPayload.title || 'Desco CRM',
      body: notificationPayload.body || 'Yangi bildirishnoma',
      icon: notificationPayload.icon || '/public/favicon.ico',
      badge: notificationPayload.badge || '/public/favicon.ico',
      url: notificationPayload.url || '/',
      timestamp: Date.now()
    });

    let sent = 0;
    for (const sub of subs) {
      try {
        const pushSubscriptionObj = {
          endpoint: sub.endpoint,
          keys: JSON.parse(sub.keys)
        };
        await webPush.sendNotification(pushSubscriptionObj, payload);
        sent++;
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          // Subscription expired or unsubscribed on phone/browser — remove stale entry
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
        }
      }
    }

    return { count: sent };
  } catch (err) {
    console.error('[Push Send Error]:', err.message);
    return { count: 0, error: err.message };
  }
}

// 3. Send push notification to all users with role (e.g. 'admin' or 'manager')
async function sendPushToRole(role, notificationPayload) {
  try {
    const users = await prisma.user.findMany({
      where: { role },
      select: { id: true }
    });

    let totalSent = 0;
    for (const u of users) {
      const res = await sendPushToUser(u.id, notificationPayload);
      totalSent += res.count || 0;
    }
    return { count: totalSent };
  } catch (e) {
    return { count: 0 };
  }
}

// 4. Background Cron Runner for Callback Tasks (Qayta Aloqa Vaqti Kelganda Push Yuborish)
const notifiedTaskIds = new Set();

setInterval(async () => {
  try {
    const now = new Date();
    const tenMinsFromNow = new Date(now.getTime() + 10 * 60 * 1000);

    // Find pending tasks due around now that have not been notified yet
    const dueTasks = await prisma.task.findMany({
      where: {
        completed: false,
        dueDate: { lte: tenMinsFromNow }
      },
      include: {
        deal: { select: { id: true, productName: true, contactName: true, contactPhone: true } },
        assignedTo: { select: { id: true, fullName: true } }
      },
      take: 50
    });

    for (const task of dueTasks) {
      if (notifiedTaskIds.has(task.id)) continue;
      notifiedTaskIds.add(task.id);

      const targetUserId = task.assignedToId || task.deal?.managerId;
      if (targetUserId) {
        const clientName = task.deal?.contactName || task.deal?.productName || 'Mijoz';
        await sendPushToUser(targetUserId, {
          title: '⏰ Qayta Aloqa Vaqti Keldi!',
          body: `${clientName} bilan bog'lanish vaqti bo'ldi (${task.title || 'Qayta aloqa'})`,
          url: `/deals?dealId=${task.dealId || ''}`
        });
      }
    }

    // Keep memory clean
    if (notifiedTaskIds.size > 2000) {
      notifiedTaskIds.clear();
    }
  } catch (e) {
    // ignore cron errors
  }
}, 60 * 1000); // Check every 60 seconds

module.exports = {
  saveSubscription,
  sendPushToUser,
  sendPushToRole,
  vapidPublicKey
};
