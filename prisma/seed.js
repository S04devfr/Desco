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

  console.log('⚡ Running High-Speed Fail-Safe Bulk Seed into PostgreSQL...');
  const fileContent = fs.readFileSync(seedPath, 'utf8');
  const backup = JSON.parse(fileContent);
  const data = backup.data;

  // Helper date parser
  const parseDates = (arr) => {
    if (!arr || !Array.isArray(arr)) return [];
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

  // 3. Companies & Contacts (MUST BE BEFORE DEALS!)
  if (data.companies && data.companies.length > 0) {
    console.log(`🌱 Seeding ${data.companies.length} Companies...`);
    await prisma.company.createMany({ data: parseDates(data.companies), skipDuplicates: true });
  }

  if (data.contacts && data.contacts.length > 0) {
    console.log(`🌱 Seeding ${data.contacts.length} Contacts...`);
    await prisma.contact.createMany({ data: parseDates(data.contacts), skipDuplicates: true });
  }

  // 4. Clients (4167 items)
  if (data.clients && data.clients.length > 0) {
    console.log(`🌱 Seeding ${data.clients.length} Clients...`);
    await prisma.client.createMany({ data: parseDates(data.clients), skipDuplicates: true });
  }

  // Fetch valid reference ID sets to prevent foreign key constraint failures
  const [dbContacts, dbCompanies, dbClients, dbUsers, dbStages] = await Promise.all([
    prisma.contact.findMany({ select: { id: true } }),
    prisma.company.findMany({ select: { id: true } }),
    prisma.client.findMany({ select: { id: true } }),
    prisma.user.findMany({ select: { id: true } }),
    prisma.pipelineStage.findMany({ select: { id: true } })
  ]);

  const contactSet = new Set(dbContacts.map(c => c.id));
  const companySet = new Set(dbCompanies.map(c => c.id));
  const clientSet  = new Set(dbClients.map(c => c.id));
  const userSet    = new Set(dbUsers.map(u => u.id));
  const stageSet   = new Set(dbStages.map(s => s.id));

  // 5. Deals (492 items) — Sanitize FKs
  if (data.deals && data.deals.length > 0) {
    console.log(`🌱 Seeding ${data.deals.length} Deals...`);
    const cleanDeals = parseDates(data.deals).map(d => {
      return {
        ...d,
        contactId: (d.contactId && contactSet.has(d.contactId)) ? d.contactId : null,
        companyId: (d.companyId && companySet.has(d.companyId)) ? d.companyId : null,
        clientId:  (d.clientId && clientSet.has(d.clientId)) ? d.clientId : null,
        managerId: (d.managerId && userSet.has(d.managerId)) ? d.managerId : null,
        ownerId:   (d.ownerId && userSet.has(d.ownerId)) ? d.ownerId : null,
        stageId:   (d.stageId && stageSet.has(d.stageId)) ? d.stageId : null
      };
    });
    await prisma.deal.createMany({ data: cleanDeals, skipDuplicates: true });
  }

  // 6. Tasks — Sanitize FKs
  if (data.tasks && data.tasks.length > 0) {
    console.log(`🌱 Seeding ${data.tasks.length} Tasks...`);
    const dbDeals = await prisma.deal.findMany({ select: { id: true } });
    const dealSet = new Set(dbDeals.map(d => d.id));

    const cleanTasks = parseDates(data.tasks).map(t => {
      return {
        ...t,
        dealId: (t.dealId && dealSet.has(t.dealId)) ? t.dealId : null,
        clientId: (t.clientId && clientSet.has(t.clientId)) ? t.clientId : null,
        contactId: (t.contactId && contactSet.has(t.contactId)) ? t.contactId : null,
        assignedToId: (t.assignedToId && userSet.has(t.assignedToId)) ? t.assignedToId : null
      };
    });
    await prisma.task.createMany({ data: cleanTasks, skipDuplicates: true });
  }

  // 7. Expenses
  if (data.expenses && data.expenses.length > 0) {
    console.log(`🌱 Seeding ${data.expenses.length} Expenses...`);
    await prisma.expense.createMany({ data: parseDates(data.expenses), skipDuplicates: true });
  }

  // 8. Installments (Nasiyalar)
  if (data.installments && data.installments.length > 0) {
    console.log(`🌱 Seeding ${data.installments.length} Installments...`);
    await prisma.installment.createMany({ data: parseDates(data.installments), skipDuplicates: true });
  }

  console.log('✅ FAIL-SAFE HIGH-SPEED SEED COMPLETED!');
}

runFastSeed()
  .catch((e) => {
    console.error('❌ Fast seed error:', e.message);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

module.exports = runFastSeed;
