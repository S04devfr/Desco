const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function clean() {
  const deleted = await prisma.user.deleteMany({
    where: {
      OR: [
        { email: { contains: 'test' } },
        { email: { contains: 'demo' } },
        { email: { contains: 'dummy' } }
      ],
      NOT: { role: 'admin' } // preserve admins just in case
    }
  });
  console.log('Deleted dummy users:', deleted.count);
}

clean().catch(console.error).finally(() => prisma.$disconnect());
