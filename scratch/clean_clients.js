const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  try {
    const clientsToClean = await prisma.client.findMany({
      where: {
        OR: [
          { instagramId: { not: null } },
          { telegramId: { not: null } }
        ],
        OR: [
          { phone: null },
          { phone: "" }
        ],
        deals: { none: {} }
      },
      select: { id: true, name: true, instagramId: true, telegramId: true }
    });

    console.log(`Found ${clientsToClean.length} chat contacts with no phone and no deals to clean up:`);
    clientsToClean.forEach(c => {
      console.log(`- [ID: ${c.id}] Name: ${c.name} (IG: ${c.instagramId}, TG: ${c.telegramId})`);
    });

    if (clientsToClean.length > 0) {
      const ids = clientsToClean.map(c => c.id);
      
      // Delete associated messages first
      const deletedIgMsgs = await prisma.instagramMessage.deleteMany({
        where: { clientId: { in: ids } }
      });
      const deletedTgMsgs = await prisma.telegramMessage.deleteMany({
        where: { clientId: { in: ids } }
      });
      const deletedTasks = await prisma.task.deleteMany({
        where: { clientId: { in: ids } }
      });

      // Delete clients
      const deletedClients = await prisma.client.deleteMany({
        where: { id: { in: ids } }
      });

      console.log(`\n✅ Cleaned up successfully:`);
      console.log(`- Deleted ${deletedClients.count} clients`);
      console.log(`- Deleted ${deletedIgMsgs.count} Instagram messages`);
      console.log(`- Deleted ${deletedTgMsgs.count} Telegram messages`);
      console.log(`- Deleted ${deletedTasks.count} tasks`);
    } else {
      console.log('\nNo matching clients found to clean up.');
    }
  } catch (error) {
    console.error('Error during cleanup:', error);
  } finally {
    await prisma.$disconnect();
  }
}

run();
