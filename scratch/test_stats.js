require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  try {
    const msgWhere = {};
    const [messages, clientsWithDeals] = await Promise.all([
      prisma.instagramMessage.findMany({
        where: msgWhere,
        orderBy: { timestamp: 'asc' },
        select: { text: true, senderId: true, recipientId: true, timestamp: true, clientId: true, isOutgoing: true }
      }),
      prisma.client.findMany({
        where: { instagramId: { not: null } },
        select: {
          id: true,
          deals: {
            select: {
              productName: true,
              amount: true,
              notes: true,
              status: true,
              stage: {
                select: { name: true }
              }
            }
          }
        }
      })
    ]);

    console.log('Messages retrieved:', messages.length);
    console.log('Clients retrieved:', clientsWithDeals.length);

    const clientMessages = {};
    messages.forEach(msg => {
      if (!msg.clientId) return;
      if (!msg.isOutgoing && msg.text) {
        if (!clientMessages[msg.clientId]) {
          clientMessages[msg.clientId] = [];
        }
        clientMessages[msg.clientId].push(msg.text.toLowerCase());
      }
    });

    console.log('clientMessages keys:', Object.keys(clientMessages));
    console.log('Total clients with messages mapped:', Object.keys(clientMessages).length);

    let nasiyaCount = 0;
    let naqdCount = 0;
    let unspecifiedCount = 0;
    const sampleOpinions = [];

    clientsWithDeals.forEach(client => {
      const texts = clientMessages[client.id] || [];
      const combinedText = texts.join(' ');
      
      if (texts.length > 0) {
        console.log(`Client ID ${client.id} messages (${texts.length}):`, texts);
      }

      const hasNasiyaKeywords = /nasiya|muddatli|bo'lib|bolib|kredit|oyiga|oyma|ijara|variant/i.test(combinedText);
      const hasNaqdKeywords = /naqd|naqt|click|payme|karta|plastik|terminal|bitta to'lov|naxt/i.test(combinedText);

      if (hasNasiyaKeywords) {
        nasiyaCount++;
      } else if (hasNaqdKeywords) {
        naqdCount++;
      } else {
        unspecifiedCount++;
      }

      texts.forEach(t => {
        const trimmed = t.trim();
        if (trimmed.length > 10 && trimmed.length < 100 && sampleOpinions.length < 10) {
          if (!sampleOpinions.includes(trimmed)) {
            const capitalized = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
            sampleOpinions.push(capitalized);
          }
        }
      });
    });

    console.log('Nasiya count:', nasiyaCount);
    console.log('Naqd count:', naqdCount);
    console.log('Unspecified count:', unspecifiedCount);
    console.log('Sample opinions:', sampleOpinions);

  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

run();
