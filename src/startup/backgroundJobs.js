const fs = require('fs');
const path = require('path');
const prisma = require('../config/database');

let jobIntervals = [];

// Automatic Static Uploads Storage Cleanup (Older than 15 days)
function runUploadsCleanup() {
  const uploadsDir = path.join(__dirname, '../../public/uploads');
  if (!fs.existsSync(uploadsDir)) return;

  fs.readdir(uploadsDir, (err, files) => {
    if (err) {
      console.error('[Cleanup] Directory read error:', err.message);
      return;
    }

    const now = Date.now();
    const maxAge = 15 * 24 * 60 * 60 * 1000; // 15 days

    files.forEach(file => {
      if (file.startsWith('.')) return; // Skip dotfiles
      const filePath = path.join(uploadsDir, file);
      fs.stat(filePath, (err, stats) => {
        if (err) return;
        if (now - stats.mtimeMs > maxAge) {
          fs.unlink(filePath, (err) => {
            if (err) console.error(`[Cleanup] Failed to delete expired file ${file}:`, err.message);
            else console.log(`[Cleanup] Deleted expired temporary file: ${file}`);
          });
        }
      });
    });
  });
}

// Automatic Wazzup CRM Webhook and Users Sync
async function syncWazzupUsers() {
  try {
    const DEFAULT_WAZZUP_KEY = process.env.WAZZUP_API_KEY || '5ac00cdba83342748b4396624d6c4a7e';
    let settings = await prisma.companySettings.findFirst().catch(() => null);

    if (!settings) {
      settings = await prisma.companySettings.create({
        data: {
          companyName: 'DESCO CRM',
          wazzupApiKey: DEFAULT_WAZZUP_KEY,
          instagramAccessToken: DEFAULT_WAZZUP_KEY,
          instagramPageId: '17841472980151454'
        }
      }).catch(e => console.error('Error creating CompanySettings on startup:', e.message));
    } else if (!settings.wazzupApiKey || settings.wazzupApiKey.length !== 32) {
      settings = await prisma.companySettings.update({
        where: { id: settings.id },
        data: {
          wazzupApiKey: DEFAULT_WAZZUP_KEY,
          instagramAccessToken: DEFAULT_WAZZUP_KEY,
          instagramPageId: '17841472980151454'
        }
      }).catch(e => console.error('Error updating CompanySettings on startup:', e.message));
    }

    const WAZZUP_API_KEY = process.env.WAZZUP_API_KEY || settings?.wazzupApiKey || DEFAULT_WAZZUP_KEY;
    const domain = process.env.APP_URL || 'https://desco.up.railway.app';
    const webhookUrl = `${domain}/api/instagram/webhook`;

    // 1. Webhook sync
    try {
      const webhookRes = await fetch('https://api.wazzup24.com/v3/webhooks', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${WAZZUP_API_KEY}`
        },
        body: JSON.stringify({
          webhooksUri: webhookUrl,
          subscriptions: { messagesAndStatuses: true }
        })
      });
      if (webhookRes.ok) {
        console.log('[Wazzup Auto-Sync] Webhook registered successfully:', webhookUrl);
      }
    } catch (e) {
      // Ignore network errors on offline/local development
    }

    // 2. Users sync
    const users = await prisma.user.findMany({ where: { isActive: true } }).catch(() => []);
    if (!users.length) return;

    const wazzupUsers = users.map(u => ({
      id: u.id.toString(),
      name: u.fullName || u.email,
      phone: ''
    }));

    try {
      await fetch('https://api.wazzup24.com/v3/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${WAZZUP_API_KEY}`
        },
        body: JSON.stringify(wazzupUsers)
      });
    } catch (e) {}
  } catch (err) {
    console.error('[Wazzup Auto-Sync] Error:', err.message);
  }
}

// Fix stuck unread counts for Instagram and Telegram chats
async function fixStuckUnreadCounts() {
  try {
    const thresholdDate = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const igUnreadClients = await prisma.client.findMany({
      where: { instagramUnreadCount: { gt: 0 } },
      include: { messages: { orderBy: { timestamp: 'desc' }, take: 1 } }
    }).catch(() => []);

    const igIdsToReset = [];
    for (const client of igUnreadClients) {
      const lastMsg = client.messages[0];
      if (!client.instagramId || !lastMsg || lastMsg.isOutgoing || new Date(lastMsg.timestamp) < thresholdDate) {
        igIdsToReset.push(client.id);
      }
    }

    if (igIdsToReset.length > 0) {
      await prisma.client.updateMany({
        where: { id: { in: igIdsToReset } },
        data: { instagramUnreadCount: 0 }
      }).catch(() => {});
    }

    const tgUnreadClients = await prisma.client.findMany({
      where: { telegramUnreadCount: { gt: 0 } },
      include: { telegramMessages: { orderBy: { timestamp: 'desc' }, take: 1 } }
    }).catch(() => []);

    const tgIdsToReset = [];
    for (const client of tgUnreadClients) {
      const lastMsg = client.telegramMessages[0];
      if (!client.telegramId || !lastMsg || lastMsg.isOutgoing || new Date(lastMsg.timestamp) < thresholdDate) {
        tgIdsToReset.push(client.id);
      }
    }

    if (tgIdsToReset.length > 0) {
      await prisma.client.updateMany({
        where: { id: { in: tgIdsToReset } },
        data: { telegramUnreadCount: 0 }
      }).catch(() => {});
    }
  } catch (err) {
    console.error('[Unread Sync] Error during cleanup:', err.message);
  }
}

// Clean auto-generated lead metadata from deal notes
async function cleanExistingLeadNotes() {
  try {
    const dealsWithLeadNotes = await prisma.deal.findMany({
      where: {
        OR: [
          { notes: { contains: 'Lead ID:' } },
          { notes: { contains: 'Manba:' } },
          { notes: { contains: 'Qabul qilingan vaqt:' } },
          { notes: { contains: 'Meta LeadGen ID:' } }
        ]
      }
    }).catch(() => []);

    for (const d of dealsWithLeadNotes) {
      if (!d.notes) continue;
      let clean = d.notes
        .replace(/^Lead ID:[^\r\n]*/gim, '')
        .replace(/^Manba:[^\r\n]*/gim, '')
        .replace(/^Qabul qilingan vaqt:[^\r\n]*/gim, '')
        .replace(/^Tafsilotlar:\s*/gim, '')
        .replace(/^Meta LeadGen ID:[^\r\n]*/gim, '')
        .replace(/^Form ID:[^\r\n]*/gim, '')
        .replace(/^Ad ID:[^\r\n]*/gim, '')
        .trim();

      await prisma.deal.update({
        where: { id: d.id },
        data: { notes: clean || null }
      }).catch(() => {});
    }
  } catch (err) {
    console.error('[Notes Cleaner] Error:', err.message);
  }
}

// Consolidate driver transport expenses
async function consolidateDriverExpenses() {
  try {
    const existingTransport = await prisma.expense.findFirst({
      where: { category: 'transport' }
    }).catch(() => null);

    if (!existingTransport) {
      await prisma.expense.create({
        data: {
          description: 'Viloyatlararo transport va shopir yetkazib berish to\'lovlari',
          amount: 10000000,
          category: 'transport',
          date: new Date('2026-08-01T00:00:00.000Z')
        }
      }).catch(() => {});
    }
  } catch (err) {
    console.error('[Expense Sync] Error:', err.message);
  }
}

// Cleanup duplicate tasks
async function cleanupDuplicateTasks() {
  try {
    const activeTasks = await prisma.task.findMany({
      where: { completed: false, NOT: { dealId: null } },
      orderBy: { id: 'desc' },
      select: { id: true, dealId: true, title: true }
    }).catch(() => []);

    const seen = new Set();
    const toDeleteIds = [];

    for (const task of activeTasks) {
      const key = `${task.dealId}:${task.title}`;
      if (seen.has(key)) {
        toDeleteIds.push(task.id);
      } else {
        seen.add(key);
      }
    }

    if (toDeleteIds.length > 0) {
      await prisma.task.deleteMany({
        where: { id: { in: toDeleteIds } }
      }).catch(() => {});
      console.log(`[Cleanup] ${toDeleteIds.length} ta takroriy vazifa tozalandi.`);
    }
  } catch (e) {
    console.error('[Cleanup] Dublikatlarni tozalashda xato:', e.message);
  }
}

/**
 * Initialize all recurring background maintenance jobs
 */
function startBackgroundJobs() {
  // Initial run
  runUploadsCleanup();
  syncWazzupUsers();
  fixStuckUnreadCounts();
  cleanExistingLeadNotes();
  consolidateDriverExpenses();
  cleanupDuplicateTasks();

  // Scheduled timers
  const interval1 = setInterval(runUploadsCleanup, 24 * 60 * 60 * 1000);
  const interval2 = setInterval(syncWazzupUsers, 12 * 60 * 60 * 1000);
  const interval3 = setInterval(fixStuckUnreadCounts, 12 * 60 * 60 * 1000);

  jobIntervals.push(interval1, interval2, interval3);
}

/**
 * Stop background timers on graceful shutdown
 */
function stopBackgroundJobs() {
  jobIntervals.forEach(clearInterval);
  jobIntervals = [];
  console.log('[Background Jobs] All background intervals stopped cleanly.');
}

module.exports = {
  startBackgroundJobs,
  stopBackgroundJobs,
  cleanupDuplicateTasks,
  cleanExistingLeadNotes,
  consolidateDriverExpenses
};
