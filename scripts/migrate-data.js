const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function migrate() {
  console.log('🚀 Starting optimized data migration...');

  try {
    // 1. Sync User fields (fullName -> name)
    console.log('🔄 Syncing Users...');
    const users = await prisma.user.findMany();
    for (const u of users) {
      if (u.fullName && !u.name) {
        await prisma.user.update({
          where: { id: u.id },
          data: { name: u.fullName }
        });
      }
    }
    console.log(`✅ Synced ${users.length} users.`);

    // 2. Identify Won/Lost pipeline stages
    console.log('🔄 Syncing Pipeline Stages (isWon / isLost)...');
    const stages = await prisma.pipelineStage.findMany();
    let wonLostCount = 0;
    for (const s of stages) {
      const nameLower = s.name.toLowerCase();
      const statusLower = s.statusType ? s.statusType.toLowerCase() : '';
      let isWon = false;
      let isLost = false;

      if (statusLower === 'won' || nameLower.includes('won') || nameLower.includes('yutil') || nameLower.includes('100%') || nameLower.includes('olindi')) {
        isWon = true;
      }
      if (statusLower === 'lost' || nameLower.includes('lost') || nameLower.includes('rad') || nameLower.includes('otkaz') || nameLower.includes('negativ') || nameLower.includes('yo\'qot')) {
        isLost = true;
      }

      await prisma.pipelineStage.update({
        where: { id: s.id },
        data: { isWon, isLost }
      });
      wonLostCount++;
    }
    console.log(`✅ Synced ${wonLostCount} stages with isWon/isLost flags.`);

    // 3. Migrate Clients to Companies and Contacts in batch promises
    console.log('🔄 Migrating Clients to Contacts & Companies...');
    const clients = await prisma.client.findMany();
    console.log(`Found ${clients.length} clients to process.`);

    const clientMap = {}; // clientId -> { contactId, companyId }
    const companyCache = {}; // companyName -> companyId
    const companyMutex = {}; // name -> promise to avoid double creation in parallel runs

    let contactCount = 0;
    let companyCount = 0;

    const batchSize = 50;
    for (let i = 0; i < clients.length; i += batchSize) {
      const batch = clients.slice(i, i + batchSize);

      await Promise.all(batch.map(async (client) => {
        let companyId = null;

        // Resolve Company if client has company name
        if (client.company && client.company.trim()) {
          const companyName = client.company.trim();

          if (companyCache[companyName]) {
            companyId = companyCache[companyName];
          } else {
            // Check if there is already a running creation for this company to prevent race conditions
            if (!companyMutex[companyName]) {
              companyMutex[companyName] = (async () => {
                const company = await prisma.company.create({
                  data: {
                    name: companyName,
                    address: client.companyAddress || null,
                    phone: client.companyPhone || null,
                    website: client.companyWebsite || null,
                    ownerId: client.ownerId || null,
                    createdAt: client.createdAt
                  }
                });
                companyCache[companyName] = company.id;
                companyCount++;
                return company.id;
              })();
            }
            companyId = await companyMutex[companyName];
          }
        }

        // Resolve Contact Name
        const fullName = client.name ? client.name.trim() : "Noma'lum Mijoz";
        const nameParts = fullName.split(/\s+/);
        const firstName = nameParts[0] || "Noma'lum";
        const lastName = nameParts.slice(1).join(' ') || null;

        // Extract source & tags from notes/details if possible
        let source = null;
        let tags = [];

        if (client.notes) {
          const sourceMatch = client.notes.match(/Manba:\s*([^\s,(]+)/i);
          if (sourceMatch && sourceMatch[1]) {
            source = sourceMatch[1].trim();
          }
        }

        // Create Contact
        const contact = await prisma.contact.create({
          data: {
            firstName,
            lastName,
            email: client.email || null,
            phone: client.phone || null,
            position: null,
            city: client.city || null,
            source: source || 'oddiy',
            tags: tags,
            companyId,
            ownerId: client.ownerId || null,
            createdAt: client.createdAt,
            updatedAt: client.updatedAt,
            instagramId: client.instagramId || null,
            instagramUsername: client.instagramUsername || null,
            instagramUnreadCount: client.instagramUnreadCount || 0,
            telegramId: client.telegramId || null,
            telegramUsername: client.telegramUsername || null,
            telegramUnreadCount: client.telegramUnreadCount || 0
          }
        });

        clientMap[client.id] = { contactId: contact.id, companyId };
        contactCount++;
      }));

      console.log(`...processed ${Math.min(i + batchSize, clients.length)} / ${clients.length} contacts`);
    }
    console.log(`✅ Migrated ${contactCount} Contacts and created ${companyCount} Companies.`);

    // 4. Map Deals in batches
    console.log('🔄 Mapping Deals to Contact & Company schema...');
    const deals = await prisma.deal.findMany({
      include: { stage: true }
    });
    
    for (let i = 0; i < deals.length; i += batchSize) {
      const batch = deals.slice(i, i + batchSize);
      await Promise.all(batch.map(async (deal) => {
        const mapping = clientMap[deal.clientId];
        const contactId = mapping ? mapping.contactId : null;
        const companyId = mapping ? mapping.companyId : null;

        // Resolve status: open | won | lost
        let status = 'open';
        if (deal.stage) {
          if (deal.stage.isWon || deal.status === 'won') status = 'won';
          else if (deal.stage.isLost || deal.status === 'lost') status = 'lost';
        }

        await prisma.deal.update({
          where: { id: deal.id },
          data: {
            title: deal.title || deal.productName,
            contactId,
            companyId,
            ownerId: deal.ownerId || deal.managerId || null,
            status,
            closedAt: (status === 'won' || status === 'lost') ? (deal.updatedAt || new Date()) : null
          }
        });

        // Add a history record for current stage
        await prisma.dealStageHistory.create({
          data: {
            dealId: deal.id,
            fromStageId: null,
            toStageId: deal.stageId,
            changedById: deal.managerId || null,
            changedAt: deal.updatedAt || deal.createdAt
          }
        });
      }));
    }
    console.log(`✅ Mapped ${deals.length} deals and created history logs.`);

    // 5. Map Tasks in batches
    console.log('🔄 Mapping Tasks...');
    const tasks = await prisma.task.findMany();
    for (let i = 0; i < tasks.length; i += batchSize) {
      const batch = tasks.slice(i, i + batchSize);
      await Promise.all(batch.map(async (t) => {
        const mapping = clientMap[t.clientId];
        const contactId = mapping ? mapping.contactId : null;
        const companyId = mapping ? mapping.companyId : null;

        await prisma.task.update({
          where: { id: t.id },
          data: {
            contactId,
            companyId,
            status: t.completed ? 'completed' : 'todo'
          }
        });
      }));
    }
    console.log(`✅ Mapped ${tasks.length} tasks.`);

    // 6. Map Instagram Messages in batches
    console.log('🔄 Mapping Instagram Messages...');
    const igMessages = await prisma.instagramMessage.findMany({
      where: { clientId: { not: null } }
    });
    for (let i = 0; i < igMessages.length; i += batchSize) {
      const batch = igMessages.slice(i, i + batchSize);
      await Promise.all(batch.map(async (msg) => {
        const mapping = clientMap[msg.clientId];
        if (mapping && mapping.contactId) {
          await prisma.instagramMessage.update({
            where: { id: msg.id },
            data: { contactId: mapping.contactId }
          });
        }
      }));
    }
    console.log(`✅ Mapped ${igMessages.length} Instagram messages.`);

    // 7. Map Telegram Messages in batches
    console.log('🔄 Mapping Telegram Messages...');
    const tgMessages = await prisma.telegramMessage.findMany({
      where: { clientId: { not: null } }
    });
    for (let i = 0; i < tgMessages.length; i += batchSize) {
      const batch = tgMessages.slice(i, i + batchSize);
      await Promise.all(batch.map(async (msg) => {
        const mapping = clientMap[msg.clientId];
        if (mapping && mapping.contactId) {
          await prisma.telegramMessage.update({
            where: { id: msg.id },
            data: { contactId: mapping.contactId }
          });
        }
      }));
    }
    console.log(`✅ Mapped ${tgMessages.length} Telegram messages.`);

    console.log('🎉 Data migration completed successfully!');
  } catch (error) {
    console.error('❌ Data migration failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

migrate();
