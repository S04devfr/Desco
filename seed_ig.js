const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function seed() {
  console.log('Seeding mock Instagram clients...');
  
  const clients = [
    { name: 'Ali Valiyev', instagramId: 'ig_12345', notes: 'Sotib olish niyatida' },
    { name: 'Olim Karimov', instagramId: 'ig_67890', notes: 'Narx so\'radi' },
    { name: 'AI Test Client (Bot)', instagramId: 'ig_ai_bot', notes: 'Sun\'iy intellekt orqali mijozdek gaplashadigan test akkaunt' }
  ];

  for (const c of clients) {
    let existing = await prisma.client.findFirst({ where: { instagramId: c.instagramId } });
    if (!existing) {
      existing = await prisma.client.create({
        data: {
          name: c.name,
          instagramId: c.instagramId,
          notes: c.notes
        }
      });
      console.log(`Created client: ${existing.name}`);
      
      // Add a greeting message
      await prisma.instagramMessage.create({
        data: {
          messageId: `msg_${Date.now()}_${Math.random()}`,
          text: c.instagramId === 'ig_ai_bot' ? 'Assalomu alaykum! Sizlardan mahsulot sotib olmoqchi edim, yordam bera olasizmi?' : 'Salom, mahsulot narxi qancha?',
          senderId: c.instagramId,
          recipientId: 'CRM',
          timestamp: new Date(),
          isOutgoing: false,
          clientId: existing.id
        }
      });
    } else {
      console.log(`Client already exists: ${existing.name}`);
    }
  }
  
  console.log('Seeding finished.');
  process.exit(0);
}

seed().catch(console.error);
