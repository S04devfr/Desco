const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function main() {
  const seedPath = path.join(__dirname, 'seed_data.json');
  if (!fs.existsSync(seedPath)) {
    console.log('⚠️ No seed_data.json file found. Skipping data import.');
    return;
  }

  console.log('🔄 Loading CRM Seed Data into database...');
  const fileContent = fs.readFileSync(seedPath, 'utf8');
  const backup = JSON.parse(fileContent);
  const data = backup.data;

  // 1. Seed Users
  if (data.users && data.users.length > 0) {
    console.log(`🌱 Seeding ${data.users.length} Users...`);
    for (const u of data.users) {
      const { id, ...uData } = u;
      await prisma.user.upsert({
        where: { email: u.email },
        update: { ...uData },
        create: { id, ...uData }
      });
    }
  }

  // 2. Seed Pipelines & Stages
  if (data.pipelines && data.pipelines.length > 0) {
    console.log(`🌱 Seeding ${data.pipelines.length} Pipelines...`);
    for (const p of data.pipelines) {
      const { id, ...pData } = p;
      await prisma.pipeline.upsert({
        where: { id },
        update: { ...pData },
        create: { id, ...pData }
      });
    }
  }

  if (data.pipelineStages && data.pipelineStages.length > 0) {
    console.log(`🌱 Seeding ${data.pipelineStages.length} Pipeline Stages...`);
    for (const st of data.pipelineStages) {
      const { id, ...stData } = st;
      await prisma.pipelineStage.upsert({
        where: { id },
        update: { ...stData },
        create: { id, ...stData }
      });
    }
  }

  // 3. Seed Clients (4167 clients)
  if (data.clients && data.clients.length > 0) {
    console.log(`🌱 Seeding ${data.clients.length} Clients...`);
    for (const c of data.clients) {
      const { id, ...cData } = c;
      await prisma.client.upsert({
        where: { id },
        update: { ...cData },
        create: { id, ...cData }
      });
    }
  }

  // 4. Seed Deals (492 deals)
  if (data.deals && data.deals.length > 0) {
    console.log(`🌱 Seeding ${data.deals.length} Deals...`);
    for (const d of data.deals) {
      const { id, ...dData } = d;
      await prisma.deal.upsert({
        where: { id },
        update: { ...dData },
        create: { id, ...dData }
      });
    }
  }

  // 5. Seed Tasks (88 tasks)
  if (data.tasks && data.tasks.length > 0) {
    console.log(`🌱 Seeding ${data.tasks.length} Tasks...`);
    for (const t of data.tasks) {
      const { id, ...tData } = t;
      await prisma.task.upsert({
        where: { id },
        update: { ...tData },
        create: { id, ...tData }
      });
    }
  }

  // 6. Seed Expenses
  if (data.expenses && data.expenses.length > 0) {
    console.log(`🌱 Seeding ${data.expenses.length} Expenses...`);
    for (const e of data.expenses) {
      const { id, ...eData } = e;
      await prisma.expense.upsert({
        where: { id },
        update: { ...eData },
        create: { id, ...eData }
      });
    }
  }

  // 7. Seed Installments (Nasiyalar)
  if (data.installments && data.installments.length > 0) {
    console.log(`🌱 Seeding ${data.installments.length} Installments...`);
    for (const inst of data.installments) {
      const { id, ...instData } = inst;
      await prisma.installment.upsert({
        where: { id },
        update: { ...instData },
        create: { id, ...instData }
      });
    }
  }

  console.log('✅ CRM Seed Data import finished successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
