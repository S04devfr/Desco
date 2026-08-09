const prisma = require('../src/config/database');

async function main() {
  console.log('--- Clearing Telegram Account & All Chats ---');

  // 1. Delete all telegram messages
  const deletedMessages = await prisma.telegramMessage.deleteMany({});
  console.log(`Deleted ${deletedMessages.count} TelegramMessage records.`);

  // 2. Unlink telegramId from clients
  const updatedClients = await prisma.client.updateMany({
    where: { telegramId: { not: null } },
    data: { telegramId: null, telegramUnreadCount: 0 }
  });
  console.log(`Unlinked ${updatedClients.count} Client records.`);

  // 3. Clear settings
  const settings = await prisma.companySettings.findFirst();
  if (settings) {
    await prisma.companySettings.update({
      where: { id: settings.id },
      data: {
        telegramSessionString: null,
        telegramPhone: null,
        telegramApiId: null,
        telegramApiHash: null
      }
    });
    console.log('Cleared Telegram session and account details from CompanySettings.');
  }

  console.log('=== Telegram Account & Chats Successfully Removed! ===');
  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Error clearing telegram account:', err);
  process.exit(1);
});
