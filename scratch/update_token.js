const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  try {
    const token = '44763853d63c4544adad7ba9cb74ca4c';
    const existing = await prisma.companySettings.findFirst();

    if (existing) {
      const updated = await prisma.companySettings.update({
        where: { id: existing.id },
        data: { instagramAccessToken: token }
      });
      console.log('✅ Updated existing CompanySettings. New token:', updated.instagramAccessToken);
    } else {
      const created = await prisma.companySettings.create({
        data: {
          companyName: 'DESCO CRM',
          currency: 'UZS',
          instagramAccessToken: token
        }
      });
      console.log('✅ Created default CompanySettings with new token:', created.instagramAccessToken);
    }
  } catch (error) {
    console.error('Error updating token:', error);
  } finally {
    await prisma.$disconnect();
  }
}

run();
