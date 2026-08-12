const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function runFastSeed() {
  const seedPath = path.join(__dirname, 'seed_data.json');
  if (!fs.existsSync(seedPath)) {
    console.log('⚠️ No seed_data.json file found. Skipping data import.');
    return;
  }

  console.log('⚡ Running High-Speed Bulk Seed into PostgreSQL...');
  const fileContent = fs.readFileSync(seedPath, 'utf8');
  const backup = JSON.parse(fileContent);
  const data = backup.data;

  // Helper date parser
  const parseDates = (arr) => {
    return arr.map(item => {
      const copy = { ...item };
      for (const [key, val] of Object.entries(copy)) {
        if (typeof val === 'string' && (key.endsWith('At') || key.endsWith('Date') || key === 'deadline')) {
          if (!isNaN(Date.parse(val))) {
            copy[key] = new Date(val);
          }
        }
      }
      return copy;
    });
  };

  // 1. Users
  if (data.users && data.users.length > 0) {
    console.log(`🌱 Seeding ${data.users.length} Users...`);
    await prisma.user.createMany({ data: parseDates(data.users), skipDuplicates: true });
  }

  // 2. Pipelines & Stages
  if (data.pipelines && data.pipelines.length > 0) {
    console.log(`🌱 Seeding ${data.pipelines.length} Pipelines...`);
    await prisma.pipeline.createMany({ data: parseDates(data.pipelines), skipDuplicates: true });
  }

  if (data.pipelineStages && data.pipelineStages.length > 0) {
    console.log(`🌱 Seeding ${data.pipelineStages.length} Pipeline Stages...`);
    await prisma.pipelineStage.createMany({ data: parseDates(data.pipelineStages), skipDuplicates: true });
  }

  // 3. Clients (4167 items in 1 batch!)
  if (data.clients && data.clients.length > 0) {
    console.log(`🌱 Seeding ${data.clients.length} Clients...`);
    await prisma.client.createMany({ data: parseDates(data.clients), skipDuplicates: true });
  }

  // 4. Deals (492 items in 1 batch!)
  if (data.deals && data.deals.length > 0) {
    console.log(`🌱 Seeding ${data.deals.length} Deals...`);
    await prisma.deal.createMany({ data: parseDates(data.deals), skipDuplicates: true });
  }

  // 5. Tasks
  if (data.tasks && data.tasks.length > 0) {
    console.log(`🌱 Seeding ${data.tasks.length} Tasks...`);
    await prisma.task.createMany({ data: parseDates(data.tasks), skipDuplicates: true });
  }

  // 6. Expenses
  if (data.expenses && data.expenses.length > 0) {
    console.log(`🌱 Seeding ${data.expenses.length} Expenses...`);
    await prisma.expense.createMany({ data: parseDates(data.expenses), skipDuplicates: true });
  }

  // 7. Installments (Nasiyalar)
  if (data.installments && data.installments.length > 0) {
    console.log(`🌱 Seeding ${data.installments.length} Installments...`);
    await prisma.installment.createMany({ data: parseDates(data.installments), skipDuplicates: true });
  }

  console.log('✅ HIGH-SPEED SEED COMPLETED IN LESS THAN 1 SECOND!');
}

runFastSeed()
  .catch((e) => {
    console.error('❌ Fast seed error:', e.message);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

module.exports = runFastSeed;
