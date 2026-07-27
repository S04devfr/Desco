const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function countAll() {
  try {
    const models = [
      'user',
      'client',
      'pipeline',
      'pipelineStage',
      'deal',
      'activityLog',
      'expense',
      'task',
      'companySettings',
      'instagramAccount',
      'instagramMessage',
      'installment',
      'productCatalog',
      'shopir',
      'ishonchFilial'
    ];

    console.log('--- Database Table Counts ---');
    for (const model of models) {
      if (prisma[model]) {
        const count = await prisma[model].count();
        console.log(`${model}: ${count}`);
      } else {
        console.log(`${model}: Model not found on Prisma Client`);
      }
    }
  } catch (error) {
    console.error('Error counting records:', error);
  } finally {
    await prisma.$disconnect();
  }
}

countAll();
