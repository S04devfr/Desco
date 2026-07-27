const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  try {
    const client = await prisma.client.findFirst({
      where: {
        OR: [
          { name: { contains: 'muxammadrafiq1995', mode: 'insensitive' } },
          { instagramUsername: { contains: 'muxammadrafiq1995', mode: 'insensitive' } }
        ]
      },
      include: {
        messages: {
          orderBy: { timestamp: 'asc' }
        }
      }
    });

    if (!client) {
      console.log('Client not found');
    } else {
      console.log('Client found:', { id: client.id, name: client.name, username: client.instagramUsername, instagramId: client.instagramId });
      console.log('Messages:', client.messages.map(m => ({
        id: m.id,
        text: m.text,
        senderId: m.senderId,
        recipientId: m.recipientId,
        isOutgoing: m.isOutgoing,
        timestamp: m.timestamp
      })));
    }
  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

run();
