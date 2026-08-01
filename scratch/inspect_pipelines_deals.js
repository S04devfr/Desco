const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  try {
    const pipelines = await prisma.pipeline.findMany({
      include: {
        stages: {
          include: {
            _count: {
              select: { deals: true }
            }
          }
        }
      }
    });

    console.log('--- PIPELINES AND STAGES ---');
    for (const p of pipelines) {
      console.log(`Pipeline: ${p.name} (ID: ${p.id})`);
      for (const s of p.stages) {
        console.log(`  Stage: ${s.name} (ID: ${s.id}) - Deals count: ${s._count.deals}`);
      }
    }

    const totalDealsCount = await prisma.deal.count();
    console.log('\nTotal deals in DB:', totalDealsCount);

    const dealsWithoutStage = await prisma.deal.count({ where: { stageId: null } });
    console.log('Deals without stage (stageId is null):', dealsWithoutStage);

    // Let's count deals created today vs updated today
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0,0,0,0);
    const endOfToday = new Date(now);
    endOfToday.setHours(23,59,59,999);

    const createdToday = await prisma.deal.count({
      where: {
        createdAt: { gte: startOfToday, lte: endOfToday }
      }
    });
    console.log('Deals created today:', createdToday);

    const updatedToday = await prisma.deal.count({
      where: {
        updatedAt: { gte: startOfToday, lte: endOfToday }
      }
    });
    console.log('Deals updated today:', updatedToday);

    // Let's see some sample deals
    const sampleDeals = await prisma.deal.findMany({
      take: 5,
      select: {
        id: true,
        createdAt: true,
        updatedAt: true,
        productName: true,
        amount: true,
        notes: true
      }
    });
    console.log('\nSample deals:', JSON.stringify(sampleDeals, null, 2));

  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

run();
