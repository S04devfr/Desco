const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function finish() {
  console.log('🔄 Finalizing social message migration using raw SQL joins...');
  try {
    // 1. Update InstagramMessage using SQL join against lowercase "contacts" table
    const igQuery = `
      UPDATE "InstagramMessage" m
      SET "contactId" = c.id
      FROM "contacts" c
      JOIN "Client" cl ON (
        (cl.phone IS NOT NULL AND cl.phone = c.phone) OR
        (cl.phone IS NULL AND cl.name = TRIM(c."firstName" || ' ' || COALESCE(c."lastName", '')))
      )
      WHERE m."clientId" = cl.id AND m."contactId" IS NULL
    `;
    const igResult = await prisma.$executeRawUnsafe(igQuery);
    console.log(`✅ Mapped ${igResult} remaining Instagram messages.`);

    // 2. Update TelegramMessage using SQL join against lowercase "contacts" table
    const tgQuery = `
      UPDATE "TelegramMessage" m
      SET "contactId" = c.id
      FROM "contacts" c
      JOIN "Client" cl ON (
        (cl.phone IS NOT NULL AND cl.phone = c.phone) OR
        (cl.phone IS NULL AND cl.name = TRIM(c."firstName" || ' ' || COALESCE(c."lastName", '')))
      )
      WHERE m."clientId" = cl.id AND m."contactId" IS NULL
    `;
    const tgResult = await prisma.$executeRawUnsafe(tgQuery);
    console.log(`✅ Mapped ${tgResult} remaining Telegram messages.`);

    console.log('🎉 Social message migration finalized successfully!');
  } catch (error) {
    console.error('❌ Failed to finalize migration:', error);
  } finally {
    await prisma.$disconnect();
  }
}

finish();
