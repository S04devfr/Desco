const prisma = require('../src/config/database');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function runBackup() {
  console.log('🔄 Baza ma\'lumotlaridan to\'liq nusxa (Full Backup) olinmoqda...');
  
  const tables = [
    'user', 'client', 'company', 'contact', 'pipeline', 'pipelineStage',
    'deal', 'deliveryLog', 'activityLog', 'expense', 'taskBoard', 'taskColumn',
    'task', 'taskChecklistItem', 'taskComment', 'taskAttachment', 'taskActivity',
    'taskLabel', 'companySettings', 'instagramAccount', 'instagramMessage',
    'installment', 'productCatalog', 'shopir', 'ishonchFilial', 'warehouseStock',
    'warehouseLog', 'marketingLog', 'managerSalary', 'managerFine', 'plan',
    'telegramMessage', 'dealStageHistory', 'activity', 'callLog', 'pushSubscription'
  ];

  const backupPayload = {
    backupTimestamp: new Date().toISOString(),
    recordsCount: {},
    data: {}
  };

  for (const table of tables) {
    if (prisma[table] && typeof prisma[table].findMany === 'function') {
      try {
        const rows = await prisma[table].findMany();
        backupPayload.data[table] = rows;
        backupPayload.recordsCount[table] = rows.length;
        console.log(`  ✓ ${table}: ${rows.length} ta yozuv`);
      } catch (err) {
        console.warn(`  ⚠️ ${table} jadvalini o'qishda xatolik (o'tkazib yuborildi):`, err.message);
        backupPayload.data[table] = [];
        backupPayload.recordsCount[table] = 0;
      }
    }
  }

  const backupDir = path.join(__dirname, '../backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `backup_before_demo_${timestamp}.json`;
  const latestFilename = `backup_before_demo_LATEST.json`;

  const filepath = path.join(backupDir, filename);
  const latestFilepath = path.join(backupDir, latestFilename);

  fs.writeFileSync(filepath, JSON.stringify(backupPayload, null, 2), 'utf-8');
  fs.writeFileSync(latestFilepath, JSON.stringify(backupPayload, null, 2), 'utf-8');

  console.log('\n======================================================');
  console.log(`✅ BAZA TO'LIQ SAQLANDI:`);
  console.log(`   1) ${filepath}`);
  console.log(`   2) ${latestFilepath}`);
  console.log('======================================================\n');
}

runBackup()
  .catch((err) => {
    console.error('❌ Backup xatosi:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
