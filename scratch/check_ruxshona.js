const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const users = await prisma.user.findMany();
  console.log('Users:', users.map(u => ({ id: u.id, username: u.username, fullName: u.fullName, role: u.role })));
  
  const deals = await prisma.deal.findMany({ 
    select: { id: true, productName: true, managerId: true, ownerId: true, stageId: true, createdAt: true },
    orderBy: { id: 'desc' },
    take: 30
  });
  console.log('Latest 30 deals:', deals);
  
  const dealsByManager = await prisma.deal.groupBy({
    by: ['managerId'],
    _count: { _all: true }
  });
  console.log('Deals count grouped by managerId:', dealsByManager);
}

check().then(() => prisma.$disconnect()).catch(err => { console.error(err); prisma.$disconnect(); });
