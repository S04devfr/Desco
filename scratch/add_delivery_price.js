const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    console.log('Adding deliveryPrice column to Deal table...');
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "deliveryPrice" DOUBLE PRECISION NOT NULL DEFAULT 0;
    `);
    console.log('Successfully added deliveryPrice column!');
  } catch (error) {
    console.error('Error adding deliveryPrice column:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
