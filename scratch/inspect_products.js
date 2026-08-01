require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  try {
    const deals = await prisma.deal.findMany({
      select: { productName: true, amount: true }
    });
    
    const productCounts = {};
    for (const d of deals) {
      const name = d.productName;
      if (!productCounts[name]) {
        productCounts[name] = { count: 0, totalAmount: 0 };
      }
      productCounts[name].count++;
      productCounts[name].totalAmount += d.amount || 0;
    }
    
    console.log("Product Names and Counts:", JSON.stringify(productCounts, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

run();
