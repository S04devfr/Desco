const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function clearJulyDeals() {
  try {
    const startDate = new Date('2026-07-01T00:00:00.000Z');
    const endDate = new Date('2026-08-01T00:00:00.000Z');

    // First find deals from July
    const deals = await prisma.deal.findMany({
      where: {
        createdAt: {
          gte: startDate,
          lt: endDate,
        },
      },
    });

    console.log(`Found ${deals.length} deals created in July 2026.`);

    if (deals.length > 0) {
      const dealIds = deals.map(d => d.id);

      // Tasks don't cascade on delete for deals, so we delete them manually first
      const deletedTasks = await prisma.task.deleteMany({
        where: { dealId: { in: dealIds } },
      });
      console.log(`Deleted ${deletedTasks.count} associated tasks.`);

      // Delete deals (which will cascade to Installments, DeliveryLog, ActivityLog)
      const deletedDeals = await prisma.deal.deleteMany({
        where: { id: { in: dealIds } },
      });
      console.log(`Successfully deleted ${deletedDeals.count} deals.`);
    }

    console.log('Cleanup complete.');
  } catch (err) {
    console.error('Error clearing July deals:', err);
  } finally {
    await prisma.$disconnect();
  }
}

clearJulyDeals();
