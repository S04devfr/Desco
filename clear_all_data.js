const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function clearData() {
  try {
    console.log('--- Boshlanmoqda: CRM malumotlarini tozalash ---');

    const installmentCount = await prisma.installment.deleteMany();
    console.log(`O'chirildi (Installments): ${installmentCount.count}`);

    const instagramMessageCount = await prisma.instagramMessage.deleteMany();
    console.log(`O'chirildi (Instagram Messages): ${instagramMessageCount.count}`);

    const taskCount = await prisma.task.deleteMany();
    console.log(`O'chirildi (Tasks): ${taskCount.count}`);

    const activityLogCount = await prisma.activityLog.deleteMany();
    console.log(`O'chirildi (Activity Logs): ${activityLogCount.count}`);

    const expenseCount = await prisma.expense.deleteMany();
    console.log(`O'chirildi (Expenses): ${expenseCount.count}`);

    const dealCount = await prisma.deal.deleteMany();
    console.log(`O'chirildi (Deals): ${dealCount.count}`);

    const clientCount = await prisma.client.deleteMany();
    console.log(`O'chirildi (Clients): ${clientCount.count}`);

    const shopirCount = await prisma.shopir.deleteMany();
    console.log(`O'chirildi (Shopir/Drivers): ${shopirCount.count}`);

    const ishonchFilialCount = await prisma.ishonchFilial.deleteMany();
    console.log(`O'chirildi (IshonchFilial/Branches): ${ishonchFilialCount.count}`);

    const productCatalogCount = await prisma.productCatalog.deleteMany();
    console.log(`O'chirildi (Product Catalog): ${productCatalogCount.count}`);

    console.log('--- Tozalash muvaffaqiyatli yakunlandi ---');
  } catch (error) {
    console.error('Xatolik yuz berdi:', error);
  } finally {
    await prisma.$disconnect();
  }
}

clearData();
