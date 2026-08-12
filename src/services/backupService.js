const fs = require('fs');
const path = require('path');
const prisma = require('../config/database');

const BACKUP_DIR = path.join(__dirname, '../../backups');

if (!fs.existsSync(BACKUP_DIR)) {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  } catch (e) {
    console.error('Backup directory create error:', e.message);
  }
}

async function createBackup() {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `backup_desco_${timestamp}.json`;
    const filepath = path.join(BACKUP_DIR, filename);

    const [users, clients, deals, tasks, stages, pipelines, warehouses, expenses] = await Promise.all([
      prisma.user.findMany({ select: { id: true, email: true, fullName: true, role: true, isActive: true, createdAt: true } }),
      prisma.client.findMany(),
      prisma.deal.findMany({ take: 5000 }),
      prisma.task.findMany({ take: 5000 }),
      prisma.pipelineStage.findMany(),
      prisma.pipeline.findMany(),
      prisma.warehouseStock.findMany(),
      prisma.expense.findMany({ take: 5000 })
    ]);

    const backupData = {
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      stats: {
        users: users.length,
        clients: clients.length,
        deals: deals.length,
        tasks: tasks.length,
        warehouses: warehouses.length
      },
      data: { users, clients, deals, tasks, stages, pipelines, warehouses, expenses }
    };

    fs.writeFileSync(filepath, JSON.stringify(backupData, null, 2), 'utf-8');
    console.log(`✅ [Backup] Bazaviy zahira yaratildi: ${filename}`);

    cleanOldBackups();
    return { success: true, filename, filepath, stats: backupData.stats };
  } catch (err) {
    console.error('⚠️ [Backup Error]:', err.message);
    return { success: false, error: err.message };
  }
}

function cleanOldBackups(maxKeep = 14) {
  try {
    if (!fs.existsSync(BACKUP_DIR)) return;
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('backup_desco_') && f.endsWith('.json'))
      .map(f => ({ name: f, time: fs.statSync(path.join(BACKUP_DIR, f)).mtime.getTime() }))
      .sort((a, b) => b.time - a.time);

    if (files.length > maxKeep) {
      const toDelete = files.slice(maxKeep);
      for (const item of toDelete) {
        fs.unlinkSync(path.join(BACKUP_DIR, item.name));
        console.log(`🗑️ [Backup Clean] Eski zahira o'chirildi: ${item.name}`);
      }
    }
  } catch (e) {}
}

function listBackups() {
  try {
    if (!fs.existsSync(BACKUP_DIR)) return [];
    return fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('backup_desco_') && f.endsWith('.json'))
      .map(f => {
        const stat = fs.statSync(path.join(BACKUP_DIR, f));
        return {
          filename: f,
          sizeBytes: stat.size,
          createdAt: stat.mtime
        };
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  } catch (e) {
    return [];
  }
}

// Automatic daily backup cron (run every 24 hours)
setInterval(() => {
  createBackup();
}, 24 * 60 * 60 * 1000);

module.exports = {
  createBackup,
  listBackups,
  BACKUP_DIR
};
