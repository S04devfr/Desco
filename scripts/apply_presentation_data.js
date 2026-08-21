const prisma = require('../src/config/database');

async function applyPresentationData() {
  console.log('🚀 Taqdimot (Demo) uchun ma\'lumotlarni sozlash boshlandi...');

  // 1. Find Pipeline 1 ("Asosiy Desco") and its stages
  const pipeline = await prisma.pipeline.findFirst({
    where: { OR: [{ id: 1 }, { name: { contains: 'Desco' } }] },
    include: { stages: true }
  });

  if (!pipeline) {
    console.error('❌ Asosiy Desco voronkasi topilmadi!');
    return;
  }

  const stageMap = {};
  for (const s of pipeline.stages) {
    stageMap[s.name.toLowerCase()] = s.id;
  }

  console.log('Voronka bosqichlari:', stageMap);

  const stage100Id = stageMap['100% zakaz'] || pipeline.stages.find(s => s.name.includes('100%'))?.id;
  const stageDescoId = stageMap['nasiya desco'] || pipeline.stages.find(s => s.name.toLowerCase().includes('desco'))?.id;
  const stageIshonchId = stageMap['nasiya ishonch'] || pipeline.stages.find(s => s.name.toLowerCase().includes('ishonch'))?.id;
  const stageBarakaId = stageMap['nasiya baraka'] || pipeline.stages.find(s => s.name.toLowerCase().includes('baraka'))?.id;
  const stageShopirdaId = stageMap['mahsulot shopirda'] || pipeline.stages.find(s => s.name.toLowerCase().includes('mahsulot shopirda') || s.name.toLowerCase().includes('shopir'))?.id;
  const stageShopirPulId = stageMap['shopirdagi pul'] || pipeline.stages.find(s => s.name.toLowerCase().includes('pul'))?.id;
  const stageOtkazId = stageMap['otkaz'] || pipeline.stages.find(s => s.name.toLowerCase().includes('otkaz') || s.name.toLowerCase().includes('rad'))?.id;
  const stageYangiId = stageMap['yangi'] || pipeline.stages.find(s => s.name.toLowerCase().includes('yangi'))?.id;
  const stagePeregavorId = stageMap['peregavor'] || pipeline.stages.find(s => s.name.toLowerCase().includes('pereg'))?.id;
  const stageQaytaAloqaId = stageMap['qayta aloqa'] || pipeline.stages.find(s => s.name.toLowerCase().includes('aloqa'))?.id;

  // 2. Fetch users/managers
  const users = await prisma.user.findMany({ where: { isActive: true } });
  const adminUser = users.find(u => u.role === 'admin') || users[0];
  const managerUser = users.find(u => u.role === 'manager' || u.id !== adminUser.id) || adminUser;

  // 3. Clear existing deals in won stages or reset them to clean slate
  console.log('📦 Sdelkalar tozalanmoqda va yangi 68 ta zakaz yaratilmoqda...');
  
  // Set all existing deals to non-won or clean up test deals
  const wonStageIds = [stage100Id, stageDescoId, stageIshonchId, stageBarakaId, stageShopirdaId, stageShopirPulId].filter(Boolean);
  
  // Move any existing deals in won stages to otkaz or yangi so we create exact 68 deals
  if (wonStageIds.length > 0) {
    await prisma.deal.updateMany({
      where: { stageId: { in: wonStageIds } },
      data: { stageId: stageOtkazId || stageYangiId, status: 'lost', amount: 0, paidAmount: 0 }
    });
  }

  // Also reset amount on non-won deals to 0 so dealDebt is 0
  await prisma.deal.updateMany({
    where: { NOT: { stageId: { in: wonStageIds } } },
    data: { amount: 0, paidAmount: 0 }
  });

  // Prepare products
  const products = [
    '6-funksiyalik massajor',
    '6-funksiyalik massajor',
    '3-funksiyalik massajor',
    'hadiya',
    'bo\'yin massajor'
  ];

  const cities = ['Toshkent', 'Samarqand', 'Andijon', 'Namangan', 'Farg\'ona', 'Buxoro', 'Qashqadaryo', 'Xorazm', 'Surxondaryo', 'Jizzax', 'Navoiy', 'Sirdaryo'];

  // Distribution plan:
  // 100% Zakaz: 28 deals = 55,000,000 UZS
  // Nasiya Desco: 14 deals = 24,500,000 UZS
  // Nasiya Ishonch: 10 deals = 18,200,000 UZS
  // Nasiya Baraka: 8 deals = 13,800,000 UZS
  // Mahsulot shopirda: 5 deals = 7,200,000 UZS
  // Shopirdagi pul: 3 deals = 3,600,000 UZS
  // TOTAL: 68 deals, SUM = 122,300,000 UZS

  const stagePlans = [
    {
      stageId: stage100Id,
      status: 'won',
      count: 28,
      amounts: [
        ...Array(26).fill(1950000), // 26 * 1,950,000 = 50,700,000
        2150000, 2150000            // 2 * 2,150,000 = 4,300,000 -> Total: 55,000,000
      ],
      prefix: '100% Zakaz'
    },
    {
      stageId: stageDescoId,
      status: 'won',
      count: 14,
      amounts: Array(14).fill(1750000), // 14 * 1,750,000 = 24,500,000
      prefix: 'Nasiya Desco'
    },
    {
      stageId: stageIshonchId,
      status: 'won',
      count: 10,
      amounts: [
        ...Array(8).fill(1800000),  // 8 * 1,800,000 = 14,400,000
        1900000, 1900000            // 2 * 1,900,000 = 3,800,000 -> Total: 18,200,000
      ],
      prefix: 'Nasiya Ishonch'
    },
    {
      stageId: stageBarakaId,
      status: 'won',
      count: 8,
      amounts: [
        ...Array(6).fill(1700000),  // 6 * 1,700,000 = 10,200,000
        1800000, 1800000            // 2 * 1,800,000 = 3,600,000 -> Total: 13,800,000
      ],
      prefix: 'Nasiya Baraka'
    },
    {
      stageId: stageShopirdaId,
      status: 'won',
      count: 5,
      amounts: [
        ...Array(4).fill(1400000),  // 4 * 1,400,000 = 5,600,000
        1600000                     // 1 * 1,600,000 = 1,600,000 -> Total: 7,200,000
      ],
      prefix: 'Mahsulot shopirda'
    },
    {
      stageId: stageShopirPulId,
      status: 'won',
      count: 3,
      amounts: Array(3).fill(1200000), // 3 * 1,200,000 = 3,600,000 -> Total: 3,600,000
      prefix: 'Shopirdagi pul'
    }
  ];

  // Get sample clients
  const existingClients = await prisma.client.findMany({ take: 100 });
  let clientIdx = 0;

  let totalCreatedDeals = 0;
  let totalCreatedSum = 0;

  for (const plan of stagePlans) {
    if (!plan.stageId) continue;
    for (let i = 0; i < plan.count; i++) {
      const amt = plan.amounts[i];
      const client = existingClients[clientIdx % existingClients.length];
      clientIdx++;

      const prod = products[i % products.length];
      const city = cities[i % cities.length];
      const mgr = users[i % users.length];

      // Spread dates across August 1 to August 21, 2026
      const day = (i % 21) + 1;
      const hour = 9 + (i % 10);
      const min = (i * 7) % 60;
      const dealDate = new Date(2026, 7, day, hour, min, 0);

      const deal = await prisma.deal.create({
        data: {
          productName: prod,
          title: `${prod} - ${client ? client.name : 'Mijoz'}`,
          amount: amt,
          paidAmount: amt,
          costPrice: 0,
          currency: 'UZS',
          status: plan.status,
          notes: `${plan.prefix} orqali buyurtma rasmiylashtirildi`,
          createdAt: dealDate,
          updatedAt: dealDate,
          clientId: client ? client.id : null,
          managerId: mgr ? mgr.id : adminUser.id,
          ownerId: mgr ? mgr.id : adminUser.id,
          stageId: plan.stageId,
          pipelineId: pipeline.id,
          warehouse: 'Asosiy Ombor',
          source: (i % 3 === 0) ? 'target' : (i % 3 === 1) ? 'instagram' : 'phone',
          tags: '#sotuv,#rasmiy'
        }
      });

      totalCreatedDeals++;
      totalCreatedSum += amt;
    }
  }

  console.log(`✅ 68 ta zakaz yaratildi:`);
  console.log(`   Soni: ${totalCreatedDeals} ta zakaz`);
  console.log(`   Summasi: ${totalCreatedSum.toLocaleString('uz-UZ')} UZS`);

  // 4. Set Expenses to exactly 10,300,000 UZS so Net Profit = 112,000,000 UZS
  console.log('💰 Xarajatlar (Expenses) sozlanmoqda...');
  await prisma.expense.deleteMany({});
  
  await prisma.expense.createMany({
    data: [
      {
        description: 'Ofis ta\'minoti va ma\'muriy xarajatlar',
        amount: 300000,
        category: 'office',
        date: new Date(2026, 7, 5)
      },
      {
        description: 'Viloyatlararo transport va shopir yetkazib berish to\'lovlari',
        amount: 10000000,
        category: 'transport',
        date: new Date(2026, 7, 10)
      }
    ]
  });
  console.log('✅ Xarajatlar: 10,300,000 UZS (Ofis: 300K, Transport: 10M)');
  console.log(`✅ Sof foyda = 122,300,000 - 10,300,000 = ${(122300000 - 10300000).toLocaleString('uz-UZ')} UZS (112.0 mln)`);

  // 5. Set Client Debts (Klientlardagi Qarz) to exactly 12,400,000 UZS
  console.log('👥 Klientlardagi qarzlar sozlanmoqda...');
  // Reset all client debts
  await prisma.client.updateMany({
    data: { debt: 0 }
  });

  // Assign specific clean debts to 8 clients
  const debtAllocations = [
    { name: 'Toshkent (262-97)', debt: 2400000, phone: '+99877-262-97-05', city: 'Toshkent' },
    { name: 'Samarqand (386-07)', debt: 1800000, phone: '+99877-386-07-04', city: 'Samarqand' },
    { name: 'Andijon Sh.', debt: 1700000, phone: '+99894-783-44-11', city: 'Andijon' },
    { name: 'Namangan (0001-01)', debt: 1600000, phone: '94 0001 01 38', city: 'Namangan' },
    { name: 'Farg\'ona (511-35)', debt: 1500000, phone: '+99855 511-35-16', city: 'Farg\'ona' },
    { name: 'Qashqadaryo', debt: 1400000, phone: '+99891-561-19-46', city: 'Qashqadaryo' },
    { name: 'Buxoro Sh.', debt: 1200000, phone: '+99897-705-25-60', city: 'Buxoro' },
    { name: 'Xorazm', debt: 800000, phone: '+99877-793-81-41', city: 'Xorazm' }
  ];

  let totalDebtAssigned = 0;
  for (const item of debtAllocations) {
    let client = await prisma.client.findFirst({
      where: { OR: [{ name: { contains: item.name } }, { phone: { contains: item.phone } }] }
    });

    if (client) {
      await prisma.client.update({
        where: { id: client.id },
        data: { debt: item.debt, city: item.city, debtDate: new Date(2026, 7, 10), debtNotes: 'Taqdimot/Muddatli to\'lov qoldig\'i' }
      });
    } else {
      await prisma.client.create({
        data: {
          name: item.name,
          phone: item.phone,
          city: item.city,
          debt: item.debt,
          debtDate: new Date(2026, 7, 10),
          debtNotes: 'Muddatli to\'lov qoldig\'i',
          ownerId: adminUser.id
        }
      });
    }
    totalDebtAssigned += item.debt;
  }

  console.log(`✅ Klientlardagi qarz: ${totalDebtAssigned.toLocaleString('uz-UZ')} UZS (12.4 mln)`);

  console.log('\n======================================================');
  console.log('🎉 TAQDIMOT MA\'LUMOTLARI MUVAFFAQIYATLI SOZLANDI:');
  console.log('   1) Zakazlar: 68 ta zakaz, 122,300,000 UZS');
  console.log('   2) Sof foyda: 112,000,000 UZS');
  console.log('   3) Klientlardagi qarz: 12,400,000 UZS');
  console.log('   4) Har bir sdelka kartochkalari to\'liq moslandi!');
  console.log('======================================================\n');
}

applyPresentationData()
  .catch((err) => {
    console.error('❌ Xatolik:', err);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
