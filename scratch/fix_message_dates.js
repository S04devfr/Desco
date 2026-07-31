require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  try {
    console.log('Fetching all Instagram messages...');
    const igMessages = await prisma.instagramMessage.findMany({
      orderBy: { id: 'asc' }
    });
    console.log(`Found ${igMessages.length} Instagram messages.`);

    console.log('Grouping Instagram messages by clientId...');
    const igGroups = {};
    igMessages.forEach(msg => {
      const cid = msg.clientId || 0;
      if (!igGroups[cid]) igGroups[cid] = [];
      igGroups[cid].push(msg);
    });

    console.log('Preparing Instagram message updates...');
    const igUpdates = [];
    const now = new Date();

    for (const [clientId, msgs] of Object.entries(igGroups)) {
      const dayOffset = Math.floor(Math.random() * 20) + 1;
      const clientStart = new Date(now.getTime() - dayOffset * 24 * 60 * 60 * 1000);
      clientStart.setHours(Math.floor(Math.random() * 12) + 8, Math.floor(Math.random() * 60), 0, 0);

      let currentOffset = 0;
      for (const msg of msgs) {
        currentOffset += Math.floor(Math.random() * 13) + 2;
        const msgTime = new Date(clientStart.getTime() + currentOffset * 60 * 1000);
        igUpdates.push({ id: msg.id, timestamp: msgTime });
      }
    }

    console.log(`Executing ${igUpdates.length} Instagram updates in parallel chunks of 15...`);
    const CHUNK_SIZE = 15;
    for (let i = 0; i < igUpdates.length; i += CHUNK_SIZE) {
      const chunk = igUpdates.slice(i, i + CHUNK_SIZE);
      await Promise.all(chunk.map(update => 
        prisma.instagramMessage.update({
          where: { id: update.id },
          data: { timestamp: update.timestamp }
        })
      ));
      if (i % 500 === 0) console.log(`Updated ${i} / ${igUpdates.length} Instagram messages...`);
    }
    console.log('Instagram messages update completed!');

    console.log('Fetching all Telegram messages...');
    const tgMessages = await prisma.telegramMessage.findMany({
      orderBy: { id: 'asc' }
    });
    console.log(`Found ${tgMessages.length} Telegram messages.`);

    console.log('Grouping Telegram messages by clientId...');
    const tgGroups = {};
    tgMessages.forEach(msg => {
      const cid = msg.clientId || 0;
      if (!tgGroups[cid]) tgGroups[cid] = [];
      tgGroups[cid].push(msg);
    });

    console.log('Preparing Telegram message updates...');
    const tgUpdates = [];
    for (const [clientId, msgs] of Object.entries(tgGroups)) {
      const dayOffset = Math.floor(Math.random() * 20) + 1;
      const clientStart = new Date(now.getTime() - dayOffset * 24 * 60 * 60 * 1000);
      clientStart.setHours(Math.floor(Math.random() * 12) + 8, Math.floor(Math.random() * 60), 0, 0);

      let currentOffset = 0;
      for (const msg of msgs) {
        currentOffset += Math.floor(Math.random() * 13) + 2;
        const msgTime = new Date(clientStart.getTime() + currentOffset * 60 * 1000);
        tgUpdates.push({ id: msg.id, timestamp: msgTime });
      }
    }

    console.log(`Executing ${tgUpdates.length} Telegram updates in parallel chunks of 50...`);
    for (let i = 0; i < tgUpdates.length; i += CHUNK_SIZE) {
      const chunk = tgUpdates.slice(i, i + CHUNK_SIZE);
      await Promise.all(chunk.map(update => 
        prisma.telegramMessage.update({
          where: { id: update.id },
          data: { timestamp: update.timestamp }
        })
      ));
      if (i % 500 === 0) console.log(`Updated ${i} / ${tgUpdates.length} Telegram messages...`);
    }
    console.log('Telegram messages update completed!');

  } catch (err) {
    console.error('Error fixing message dates:', err);
  } finally {
    await prisma.$disconnect();
  }
}

run();
