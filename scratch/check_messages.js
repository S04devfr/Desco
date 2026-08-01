const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  try {
    const total = await prisma.instagramMessage.count();
    console.log('Total Instagram messages:', total);

    const grouped = await prisma.$queryRaw`
      SELECT DATE("timestamp") as msg_date, COUNT(*) as cnt
      FROM "InstagramMessage"
      GROUP BY msg_date
      ORDER BY msg_date DESC
      LIMIT 10
    `;
    console.log('Grouped by date:', grouped);

    const samples = await prisma.instagramMessage.findMany({
      take: 15,
      orderBy: { timestamp: 'desc' },
      select: { timestamp: true, text: true, isOutgoing: true }
    });
    console.log('Last 15 messages:', JSON.stringify(samples, null, 2));

  } catch(e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

run();
