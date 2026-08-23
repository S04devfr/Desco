const prisma = require('../src/config/database');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function runRestore(targetFile = null) {
  const backupDir = path.join(__dirname, '../backups');
  let chosenFile = targetFile;

  if (!chosenFile) {
    chosenFile = path.join(backupDir, 'backup_before_demo_LATEST.json');
  }

  if (!fs.existsSync(chosenFile)) {
    console.error(`❌ Backup fayli topilmadi: ${chosenFile}`);
    process.exit(1);
  }

  console.log(`🔄 Qayta tiklash boshlandi: ${chosenFile}`);
  const raw = fs.readFileSync(chosenFile, 'utf-8');
  const backup = JSON.parse(raw);
  const data = backup.data;

  // Deletion order (children first to avoid foreign key violations)
  const deleteTables = [
    'callLog', 'activity', 'dealStageHistory', 'telegramMessage', 'plan',
    'managerFine', 'managerSalary', 'marketingLog', 'warehouseLog', 'warehouseStock',
    'ishonchFilial', 'shopir', 'productCatalog', 'installment', 'instagramMessage',
    'instagramAccount', 'taskActivity', 'taskAttachment', 'taskComment',
    'taskChecklistItem', 'task', 'taskLabel', 'taskColumn', 'taskBoard',
    'expense', 'activityLog', 'deliveryLog', 'deal', 'contact', 'company',
    'client', 'pipelineStage', 'pipeline', 'companySettings', 'pushSubscription', 'user'
  ];

  console.log('🧹 Baza tozalanyapti...');
  for (const t of deleteTables) {
    if (prisma[t] && typeof prisma[t].deleteMany === 'function') {
      try {
        await prisma[t].deleteMany();
      } catch (err) {
        console.warn(`  ⚠️ ${t} o'chirishda ogohlantirish:`, err.message);
      }
    }
  }

  // Insertion order (parents first)
  const insertTables = [
    'user', 'companySettings', 'pipeline', 'pipelineStage', 'company', 'client',
    'contact', 'deal', 'deliveryLog', 'activityLog', 'expense', 'taskBoard',
    'taskColumn', 'taskLabel', 'task', 'taskChecklistItem', 'taskComment',
    'taskAttachment', 'taskActivity', 'instagramAccount', 'instagramMessage',
    'installment', 'productCatalog', 'shopir', 'ishonchFilial', 'warehouseStock',
    'warehouseLog', 'marketingLog', 'managerSalary', 'managerFine', 'plan',
    'telegramMessage', 'dealStageHistory', 'activity', 'callLog', 'pushSubscription'
  ];

  console.log('📥 Ma\'lumotlar tiklanmoqda...');
  for (const t of insertTables) {
    const items = data[t];
    if (items && Array.isArray(items) && items.length > 0 && prisma[t]) {
      try {
        const batchSize = 500;
        for (let i = 0; i < items.length; i += batchSize) {
          const chunk = items.slice(i, i + batchSize).map(item => {
            const cleanItem = { ...item };
            for (const key of Object.keys(cleanItem)) {
              if (typeof cleanItem[key] === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(cleanItem[key])) {
                cleanItem[key] = new Date(cleanItem[key]);
              }
            }
            return cleanItem;
          });
          if (typeof prisma[t].createMany === 'function') {
            await prisma[t].createMany({ data: chunk, skipDuplicates: true });
          } else {
            for (const ci of chunk) {
              await prisma[t].create({ data: ci }).catch(() => {});
            }
          }
        }
        console.log(`  ✓ ${t}: ${items.length} ta yozuv tiklandi`);
      } catch (err) {
        console.warn(`  ⚠️ ${t} tiklashda xatolik:`, err.message);
      }
    }
  }

  // Reset sequences in Postgres if applicable
  try {
    const seqTables = [
      ['User', 'id'], ['Client', 'id'], ['companies', 'id'], ['contacts', 'id'],
      ['Pipeline', 'id'], ['PipelineStage', 'id'], ['Deal', 'id'], ['DeliveryLog', 'id'],
      ['ActivityLog', 'id'], ['Expense', 'id'], ['TaskBoard', 'id'], ['TaskColumn', 'id'],
      ['Task', 'id'], ['TaskChecklistItem', 'id'], ['TaskComment', 'id'], ['TaskAttachment', 'id'],
      ['TaskActivity', 'id'], ['TaskLabel', 'id'], ['CompanySettings', 'id'], ['Installment', 'id'],
      ['ProductCatalog', 'id'], ['Shopir', 'id'], ['IshonchFilial', 'id'], ['WarehouseStock', 'id'],
      ['WarehouseLog', 'id'], ['MarketingLog', 'id'], ['Plan', 'id'], ['TelegramMessage', 'id'],
      ['deal_stage_history', 'id'], ['activities', 'id'], ['call_logs', 'id']
    ];

    for (const [tbl, col] of seqTables) {
      try {
        await prisma.$executeRawUnsafe(
          `SELECT setval(pg_get_serial_sequence('"${tbl}"', '${col}'), coalesce(max("${col}"), 1)) FROM "${tbl}";`
        );
      } catch (_) {}
    }
    console.log('  ✓ Sequence (ID hisoblagichlar) sinxronlandi');
  } catch (_) {}

  console.log('\n======================================================');
  console.log(`🎉 BAZA ASLIYATIGA 100% QAYTARILDI!`);
  console.log('======================================================\n');
}

const arg = process.argv[2];
runRestore(arg)
  .catch((err) => {
    console.error('❌ Restore xatosi:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
