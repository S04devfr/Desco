require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  try {
    const totalCount = await prisma.instagramMessage.count();
    console.log('Total Instagram messages in DB:', totalCount);
    
    const messagesWithClient = await prisma.instagramMessage.count({
      where: { clientId: { not: null } }
    });
    console.log('Messages with clientId populated:', messagesWithClient);
    
    const sampleMsgs = await prisma.instagramMessage.findMany({
      take: 5,
      select: { id: true, messageId: true, senderId: true, recipientId: true, text: true, clientId: true }
    });
    console.log('Sample messages:', JSON.stringify(sampleMsgs, null, 2));
    
    const clients = await prisma.client.findMany({
      where: { instagramId: { not: null } },
      take: 5,
      select: { id: true, name: true, instagramId: true, instagramUsername: true }
    });
    console.log('Sample Instagram clients in DB:', JSON.stringify(clients, null, 2));
    
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await prisma.$disconnect();
  }
}

run();
