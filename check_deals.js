const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkDeals() {
  try {
    const deal = await prisma.deal.findUnique({ where: { id: 2181 } });
    console.log('Deal 2181:', deal);
    
    const recentDeals = await prisma.deal.findMany({
      where: { stageId: 18 },
      orderBy: { updatedAt: 'desc' },
      take: 10
    });
    console.log('Recent Otkaz deals:', recentDeals.map(d => ({
      id: d.id, 
      createdAt: d.createdAt, 
      updatedAt: d.updatedAt,
      stageId: d.stageId
    })));
  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

checkDeals();
