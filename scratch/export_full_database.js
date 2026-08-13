const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

// Supabase Database URL provided by user
const SUPABASE_URL = "postgresql://postgres.jnjcysejnthpquywbgxc:muhammad12_1111.@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true";

async function exportFullDatabase() {
  console.log('🔄 Connecting to Supabase database to export ALL CRM data...');
  const prisma = new PrismaClient({
    datasources: {
      db: { url: SUPABASE_URL }
    }
  });

  try {
    const [
      users,
      clients,
      deals,
      pipelines,
      pipelineStages,
      tasks,
      expenses,
      companies,
      contacts,
      productCatalogs,
      deliveryLogs,
      companySettings,
      shopirs,
      installments,
      warehouseStocks,
      ishonchFilials
    ] = await Promise.all([
      prisma.user.findMany().catch(() => []),
      prisma.client.findMany().catch(() => []),
      prisma.deal.findMany().catch(() => []),
      prisma.pipeline.findMany().catch(() => []),
      prisma.pipelineStage.findMany().catch(() => []),
      prisma.task.findMany().catch(() => []),
      prisma.expense.findMany().catch(() => []),
      prisma.company.findMany().catch(() => []),
      prisma.contact.findMany().catch(() => []),
      prisma.productCatalog.findMany().catch(() => []),
      prisma.deliveryLog.findMany().catch(() => []),
      prisma.companySettings.findMany().catch(() => []),
      prisma.shopir.findMany().catch(() => []),
      prisma.installment.findMany().catch(() => []),
      prisma.warehouseStock.findMany().catch(() => []),
      prisma.ishonchFilial.findMany().catch(() => [])
    ]);

    const backupData = {
      exportedAt: new Date().toISOString(),
      counts: {
        users: users.length,
        clients: clients.length,
        deals: deals.length,
        tasks: tasks.length,
        expenses: expenses.length,
        installments: installments.length,
        shopirs: shopirs.length
      },
      data: {
        users,
        clients,
        deals,
        pipelines,
        pipelineStages,
        tasks,
        expenses,
        companies,
        contacts,
        productCatalogs,
        deliveryLogs,
        companySettings,
        shopirs,
        installments,
        warehouseStocks,
        ishonchFilials
      }
    };

    const targetDir = path.join(__dirname, '../prisma');
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

    const targetPath = path.join(targetDir, 'seed_data.json');
    fs.writeFileSync(targetPath, JSON.stringify(backupData, null, 2));

    console.log(`✅ SUCCESS! Exported full CRM database to ${targetPath}`);
    console.log(`📊 Statistics:`);
    console.log(`   - Users: ${users.length}`);
    console.log(`   - Clients: ${clients.length}`);
    console.log(`   - Deals: ${deals.length}`);
    console.log(`   - Tasks: ${tasks.length}`);
    console.log(`   - Expenses: ${expenses.length}`);
    console.log(`   - Installments (Nasiyalar): ${installments.length}`);
    console.log(`   - Shopirlar: ${shopirs.length}`);

  } catch (err) {
    console.error('❌ Export failed:', err.message);
  } finally {
    await prisma.$disconnect();
  }
}

exportFullDatabase();
