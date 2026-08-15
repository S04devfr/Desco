const { fixPostgresSequences } = require('./utils/sequenceSync');

/**
 * DB Auto-Migration — Server startupda avtomatik ishga tushadi.
 * PostgreSQL (Supabase) uchun moslashtirilgan.
 */
async function runMigrations(prisma) {
  console.log('🔧 DB migration boshlandi...')

  // 0. PostgreSQL sekvensiyalarini oldindan tekshirish va sinxronlash
  await fixPostgresSequences(prisma);

  // 1. Default Pipeline
  try {
    const exists = await prisma.pipeline.findFirst({ where: { isDefault: true } })
    if (!exists) {
      await prisma.pipeline.create({
        data: {
          name: 'Asosiy voronka',
          isDefault: true,
          color: '#007AFF',
          order: 1
        }
      })
      console.log('✅ Default Pipeline yaratildi')
    } else {
      console.log('✅ Default Pipeline mavjud')
    }
  } catch (e) { console.log('ℹ️  Pipeline:', e.message?.slice(0, 80)) }

  // 2. Default stages
  try {
    const pipeline = await prisma.pipeline.findFirst({ where: { isDefault: true } })
    if (pipeline) {
      const stageCount = await prisma.pipelineStage.count({ where: { pipelineId: pipeline.id } })
      if (stageCount === 0) {
        const stages = [
          { name: 'Yangi', color: '#1565C0', order: 1, isDefault: true, pipelineId: pipeline.id },
          { name: 'Muzokaralar', color: '#F57F17', order: 2, isDefault: false, pipelineId: pipeline.id },
          { name: 'Taklif', color: '#512DA8', order: 3, isDefault: false, pipelineId: pipeline.id },
          { name: 'Yutilgan', color: '#2E7D32', order: 4, isDefault: false, pipelineId: pipeline.id },
          { name: "Yo'qotilgan", color: '#C62828', order: 5, isDefault: false, pipelineId: pipeline.id },
        ]
        for (const s of stages) {
          await prisma.pipelineStage.create({ data: s })
        }
        console.log('✅ Default stages yaratildi')
      } else {
        console.log('✅ Default stages mavjud')
      }

      // Ensure V2 Nasiya stages exist
      const nasiyaStages = [
        { name: 'Shopirdagi pul', color: '#007AFF' },
        { name: 'Nasiya Desco', color: '#34C759' },
        { name: 'Nasiya Ishonch', color: '#FF9500' },
        { name: 'Nasiya Baraka', color: '#FF3B30' }
      ]
      let maxOrderRow = await prisma.pipelineStage.findFirst({
        where: { pipelineId: pipeline.id },
        orderBy: { order: 'desc' }
      })
      let nextOrder = maxOrderRow ? maxOrderRow.order + 1 : 1

      for (const ns of nasiyaStages) {
        const stageExists = await prisma.pipelineStage.findFirst({
          where: {
            pipelineId: pipeline.id,
            name: ns.name
          }
        })
        if (!stageExists) {
          await prisma.pipelineStage.create({
            data: {
              name: ns.name,
              color: ns.color,
              order: nextOrder++,
              isDefault: false,
              pipelineId: pipeline.id
            }
          })
          console.log(`✅ Nasiya stage yaratildi: ${ns.name}`)
        }
      }
    }
  } catch (e) { console.log('ℹ️  Stages:', e.message?.slice(0, 80)) }

  // 3. Default company settings
  try {
    const settings = await prisma.companySettings.findFirst()
    if (!settings) {
      await prisma.companySettings.create({
        data: { companyName: 'DESCO CRM', currency: 'UZS' }
      })
      console.log('✅ Default CompanySettings yaratildi')
    }
  } catch (e) { console.log('ℹ️  CompanySettings:', e.message?.slice(0, 80)) }

  // Auto-migrate mustChangePassword column on PostgreSQL/SQLite User table
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mustChangePassword" BOOLEAN DEFAULT false;`);
  } catch (_) {
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN "mustChangePassword" BOOLEAN DEFAULT false;`);
    } catch (_) {}
  }

  // Ensure Telegram/Instagram columns exist (SQLite fallback auto-migration)
  const isSQLite = process.env.DATABASE_URL && (process.env.DATABASE_URL.includes('.db') || process.env.DATABASE_URL.startsWith('file:'));
  if (isSQLite) {
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE "CompanySettings" ADD COLUMN "telegramSessionString" TEXT`);
    } catch (e) {}
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE "CompanySettings" ADD COLUMN "telegramPhone" TEXT`);
    } catch (e) {}
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE "CompanySettings" ADD COLUMN "telegramApiId" TEXT`);
    } catch (e) {}
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE "CompanySettings" ADD COLUMN "telegramApiHash" TEXT`);
    } catch (e) {}
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE "CompanySettings" ADD COLUMN "instagramAccessToken" TEXT`);
    } catch (e) {}
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE "CompanySettings" ADD COLUMN "instagramPageId" TEXT`);
    } catch (e) {}
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE "CompanySettings" ADD COLUMN "instagramVerifyToken" TEXT`);
    } catch (e) {}

    // Ensure attachment columns exist in InstagramMessage
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE "InstagramMessage" ADD COLUMN "attachmentType" TEXT`);
    } catch (e) {}
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE "InstagramMessage" ADD COLUMN "attachmentUrl" TEXT`);
    } catch (e) {}
  }

  // 4. Admin user (agar mavjud bo'lmasa)
  try {
    const bcrypt = require('bcryptjs')
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@desco.com'
    const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@123'
    const existing = await prisma.user.findUnique({ where: { email: adminEmail } })
    if (!existing) {
      const hash = await bcrypt.hash(adminPassword, 12)
      await prisma.user.create({
        data: {
          email: adminEmail,
          password: hash,
          fullName: 'Administrator',
          role: 'admin'
        }
      })
      console.log('✅ Admin user yaratildi: ' + adminEmail)
    } else {
      console.log('✅ Admin user mavjud')
    }
  } catch (e) { console.log('ℹ️  Admin user:', e.message?.slice(0, 80)) }

  // 5. Zakazlar Holati Pipeline — to'g'ri delivery bosqichlari bilan
  try {
    const DLV_STAGES = [
      { name: 'Yangi',          color: '#1565C0', order: 1 },
      { name: 'Taksi kelyapti',  color: '#6A1B9A', order: 2 },
      { name: 'Kutilyapti',     color: '#E65100', order: 3 },
      { name: 'Yolda',          color: '#2E7D32', order: 4 },
      { name: 'Yetib bordi',    color: '#00796B', order: 5 },
    ]
    const DLV_NAMES = DLV_STAGES.map(s => s.name)

    // "zakaz" so'zini o'z ichiga olgan har qanday nomli pipeline (case-insensitive)
    let dlvPipeline = await prisma.pipeline.findFirst({
      where: { name: { contains: 'zakaz', mode: 'insensitive' } },
      include: { stages: { orderBy: { order: 'asc' } } }
    })

    if (!dlvPipeline) {
      dlvPipeline = await prisma.pipeline.create({
        data: { name: 'Zakazlar Holati', isDefault: false, color: '#FF9500', order: 2 }
      })
      dlvPipeline.stages = []
      console.log('✅ Zakazlar Holati pipeline yaratildi')
    }

    const existingNames = (dlvPipeline.stages || []).map(s => s.name)
    const hasWrongStages = existingNames.some(n => !DLV_NAMES.includes(n))

    if (hasWrongStages) {
      // Noto'g'ri stages (default Yangi/Muzokaralar...) o'chirib to'g'rilarini qo'yamiz
      await prisma.pipelineStage.deleteMany({ where: { pipelineId: dlvPipeline.id } })
      for (const s of DLV_STAGES) {
        await prisma.pipelineStage.create({ data: { ...s, pipelineId: dlvPipeline.id } })
      }
      console.log('✅ Zakazlar Holati bosqichlari tuzatildi')
    } else if (existingNames.length < DLV_STAGES.length) {
      for (const s of DLV_STAGES) {
        if (!existingNames.includes(s.name)) {
          await prisma.pipelineStage.create({ data: { ...s, pipelineId: dlvPipeline.id } })
        }
      }
      console.log('✅ Zakazlar Holati bosqichlari qo\'shildi')
    } else {
      console.log('✅ Zakazlar Holati bosqichlari to\'g\'ri')
    }
  } catch (e) { console.log('ℹ️  Zakazlar Holati pipeline:', e.message?.slice(0, 80)) }

  // ── 6. ManagerSalary va ManagerFine jadvallarini tekshirish ──
  try {
    await prisma.managerSalary.findFirst()
    console.log('✅ ManagerSalary jadvali mavjud')
  } catch (e) {
    try {
      if (isSQLite) {
        await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "ManagerSalary" (
          "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
          "managerId" INTEGER NOT NULL UNIQUE,
          "baseSalary" REAL NOT NULL DEFAULT 0,
          "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "ManagerSalary_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
        )`)
        await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "ManagerFine" (
          "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
          "managerId" INTEGER NOT NULL,
          "month" TEXT NOT NULL,
          "amount" REAL NOT NULL DEFAULT 0,
          "reason" TEXT,
          "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "ManagerFine_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
        )`)
      } else {
        await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "ManagerSalary" (
          "id" SERIAL PRIMARY KEY,
          "managerId" INTEGER NOT NULL UNIQUE,
          "baseSalary" DOUBLE PRECISION NOT NULL DEFAULT 0,
          "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "ManagerSalary_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
        )`)
        await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "ManagerFine" (
          "id" SERIAL PRIMARY KEY,
          "managerId" INTEGER NOT NULL,
          "month" VARCHAR(10) NOT NULL,
          "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
          "reason" TEXT,
          "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "ManagerFine_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
        )`)
      }
      console.log('✅ ManagerSalary va ManagerFine jadvallari yaratildi')
    } catch (err) { console.log('⚠️  ManagerSalary/Fine jadval:', err.message?.slice(0, 80)) }
  }

  // UserActivityLog — menejer online vaqtini kuzatish
  try {
    await prisma.$executeRawUnsafe(`SELECT 1 FROM "UserActivityLog" LIMIT 1`)
    console.log('✅ UserActivityLog jadvali mavjud')
  } catch (e) {
    try {
      if (isSQLite) {
        await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "UserActivityLog" (
          "id"           INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
          "userId"       INTEGER NOT NULL,
          "date"         TEXT NOT NULL,
          "sessionStart" TEXT NOT NULL,
          "lastPing"     TEXT NOT NULL,
          "durationMin"  INTEGER NOT NULL DEFAULT 0,
          "isActive"     INTEGER NOT NULL DEFAULT 1,
          "createdAt"    TEXT NOT NULL,
          "updatedAt"    TEXT NOT NULL,
          CONSTRAINT "UAL_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
        )`)
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_ual_userId_date" ON "UserActivityLog"("userId","date")`)
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_ual_lastPing"    ON "UserActivityLog"("lastPing")`)
      } else {
        await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "UserActivityLog" (
          "id"           SERIAL PRIMARY KEY,
          "userId"       INTEGER NOT NULL,
          "date"         VARCHAR(50) NOT NULL,
          "sessionStart" VARCHAR(50) NOT NULL,
          "lastPing"     VARCHAR(50) NOT NULL,
          "durationMin"  INTEGER NOT NULL DEFAULT 0,
          "isActive"     INTEGER NOT NULL DEFAULT 1,
          "createdAt"    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt"    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "UAL_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
        )`)
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_ual_userId_date" ON "UserActivityLog"("userId","date")`)
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_ual_lastPing"    ON "UserActivityLog"("lastPing")`)
      }
      console.log('✅ UserActivityLog jadvali yaratildi')
    } catch (err) { console.log('⚠️  UserActivityLog:', err.message?.slice(0, 80)) }
  }

  // ── 7. 32 Ta Haqiqiy Qarzdorlarni Kiritish ──
  try {
    const realDebtors = [
      { name: "Саида", phone: "+99897 705-25-60", date: "2026-01-16", amount: 3150000, city: "Коракалпогистон  Нукуз", manager: "Ko'rsatilmadi", notes: "Izohi: Mavjud emas (Menejer: Ko'rsatilmadi)" },
      { name: "Абдулазиз", phone: "+99890 387-20-01", date: "2026-02-04", amount: 200000, city: "Наманган", manager: "Ko'rsatilmadi", notes: "Бугун ташеди (3350000) | Qayta aloqa: 06.06.2026" },
      { name: "Гайрат", phone: "+99888 183-69-83", date: "2026-03-04", amount: 300000, city: "Сирдарё", manager: "Мираббос", notes: "Эртага беради | Qayta aloqa: 29.06.2026 (Menejer: Мираббос)" },
      { name: "Жизах", phone: "+99897 776-10-12", date: "2026-03-08", amount: 300000, city: "Жизах", manager: "Мираббос", notes: "Qayta aloqa: 29.06.2026 (Menejer: Мираббос)" },
      { name: "Андижон", phone: "+99894 783-44-11", date: "2026-03-10", amount: 1250000, city: "Андижон", manager: "Мираббос", notes: "Menejer: Мираббос" },
      { name: "Тошкент", phone: "+99897 011-11-47", date: "2026-03-27", amount: 1600000, city: "Пискент", manager: "Мираббос", notes: "Бугун беради | Qayta aloqa: 08.05.2026 (Menejer: Мираббос)" },
      { name: "Илхом ака Лочин", phone: "+99891 683-00-71", date: "2026-06-12", amount: 2800000, city: "Кукон", manager: "Мираббос", notes: "Ойлик олса беради 2 та олди | Qayta aloqa: 05.07.2026 (Menejer: Мираббос)" },
      { name: "Тошкент (776-97)", phone: "+99897 776-97-73", date: "2026-07-17", amount: 1200000, city: "Тошкент", manager: "Мираббос", notes: "Эски карздорлик (Menejer: Мираббос)" },
      { name: "Кашкадарё", phone: "+99891-561-19-46", date: "2026-07-17", amount: 3400000, city: "Кашкадарё", manager: "Мираббос", notes: "Эски карздорлик (Menejer: Мираббос)" },
      { name: "Тошкент (335-44)", phone: "95-335-44-33", date: "2026-07-28", amount: 400000, city: "Тошкент", manager: "Мираббос", notes: "Буйин массажёр олган (11250000) | Qayta aloqa: 08.08.2026 (Menejer: Мираббос)" },
      { name: "Тошкент (641-88)", phone: "+99895 641-88-48", date: "2026-06-02", amount: 50000, city: "Тошкент", manager: "Абдумалик", notes: "50 000 колди бугун беради | Qayta aloqa: 03.08.2026 (Menejer: Абдумалик)" },
      { name: "Сирдарё", phone: "+99850-095-27-27", date: "2026-06-12", amount: 100000, city: "Сирдарё", manager: "Абдумалик", notes: "котармади кайта алока | Qayta aloqa: 01.08.2026 (Menejer: Абдумалик)" },
      { name: "Сурхандарё", phone: "+99833-799-09-11", date: "2026-07-01", amount: 1200000, city: "Сурхандарё", manager: "Абдумалик", notes: "Хар Жума 600 дан беради кайта алока тел очик | Qayta aloqa: 03.08.2026 (Menejer: Абдумалик)" },
      { name: "Самарканд (151-11)", phone: "+99895-151-11-67", date: "2026-06-15", amount: 100000, city: "Самарканд", manager: "Абдумалик", notes: "1 800 000 дагавор булди 500 берди котармади кайта алока | Qayta aloqa: 03.08.2026 (Menejer: Абдумалик)" },
      { name: "Жиззах", phone: "+99899-582-15-19", date: "2026-06-26", amount: 100000, city: "Жиззах", manager: "Абдумалик", notes: "1 700 000 дагавор 600 берди душанба беради | Qayta aloqa: 01.08.2026 (Menejer: Абдумалик)" },
      { name: "Тошкент (435-76)", phone: "+99893-435-76-73", date: "2026-06-26", amount: 1300000, city: "Тошкент", manager: "Абдумалик", notes: "Массажёр 6 ертага кечга котармади кайта алока | Qayta aloqa: 03.08.2026 (Menejer: Абдумалик)" },
      { name: "Тошкент (186-09)", phone: "+998931860922", date: "2026-07-09", amount: 400000, city: "Тошкент", manager: "Абдумаликк", notes: "1 600 000 Дагавор килинган кайта алока (3250000) | Qayta aloqa: 05.08.2026 (Menejer: Абдумаликк)" },
      { name: "Тошкент (262-97)", phone: "+99877-262-97-05", date: "2026-06-23", amount: 1800000, city: "Тошкент", manager: "Кодир", notes: "1 800 000 бериш керак кутармади 102 килинади | Qayta aloqa: 01.07.2026 (Menejer: Кодир)" },
      { name: "Наманган (0001-01)", phone: "94 0001 01 38", date: "2026-07-21", amount: 900000, city: "Наманган", manager: "Кодир", notes: "1.8 ертагаликга заказ 900 нахт колгани 20 кунда 900 | Qayta aloqa: 10.08.2026 (Menejer: Кодир)" },
      { name: "Наманган (694-65)", phone: "90-694 65 62", date: "2026-07-20", amount: 1400000, city: "Наманган", manager: "Кодир", notes: "Хар 2 - 3 кунда 200 дан ташеди (200 берди 10.08) | Qayta aloqa: 10.08.2026 (Menejer: Кодир)" },
      { name: "Кукон", phone: "90-586-57-74", date: "2026-07-25", amount: 600000, city: "Кукон", manager: "Кодир", notes: "600 клик А | Qayta aloqa: 10.08.2026 (Menejer: Кодир)" },
      { name: "Фаргона (537-21)", phone: "+99890 537-21-56", date: "2026-05-26", amount: 400000, city: "Фаргона", manager: "Кодирхон", notes: "Бугун беради уирилган кодирхон ака берадилар, клиент номерини очириб юборган | Qayta aloqa: 16.06.2025 (Menejer: Кодирхон)" },
      { name: "Фаргона (511-35)", phone: "+99855 511-35-16", date: "2026-05-26", amount: 950000, city: "Фаргога", manager: "Кодирхон", notes: "Ойлик олса беради душанба (6050000) | Qayta aloqa: 28.06.2026 (Menejer: Кодирхон)" },
      { name: "Тошкент (683-00)", phone: "91 683-00-71", date: "2026-07-25", amount: 400000, city: "Тошкент", manager: "Исмоилхо", notes: "Исмоилхон уртоги олган 1 400 барака 1 млн берган 400 колди | Qayta aloqa: 05.09.2026 (Menejer: Исмоилхо)" },
      { name: "Самарканд (386-07)", phone: "+99877-386-07-04", date: "2026-06-13", amount: 530000, city: "Самарканд", manager: "Аюбхон", notes: "1 800 000 келишдик 1 270 берди коганин 5-10 кунда беради очирилган | Qayta aloqa: 03.08.2026 (Menejer: Аюбхон)" },
      { name: "Такси Наманган", phone: "+99897-828-15-55", date: "2026-03-14", amount: 1250000, city: "Кукон", manager: "Мираббос", notes: "Бугун ташаб беради | Qayta aloqa: 04.05.2026 (Menejer: Мираббос)" },
      { name: "Такси Самарканд", phone: "+99850-511-66-99", date: "2026-06-02", amount: 1300000, city: "Самарканд", manager: "Абдумалик", notes: "Бугун ташаб беради | Qayta aloqa: 02.06.2026 (Menejer: Абдумалик)" },
      { name: "Такси Навойи", phone: "+99897-787-97-87", date: "2026-06-03", amount: 1640000, city: "Навойи", manager: "Кодир", notes: "Бугун ташаб беради | Qayta aloqa: 11.06.2026 (Menejer: Кодир)" },
      { name: "Такси Корапалпок", phone: "+99897-354-91-70", date: "2026-07-08", amount: 220000, city: "Корапалпок", manager: "Абдумалик", notes: "Бугун ташаб беради | Qayta aloqa: 17.06.2026 (Menejer: Абдумалик)" },
      { name: "Хоразм Шофёр", phone: "+99877-793-81-41", date: "2026-07-21", amount: 1300000, city: "Хоразм", manager: "Ko'rsatilmadi", notes: "Бугун ташаб беради | Qayta aloqa: 08.08.2026 (Menejer: Ko'rsatilmadi)" },
      { name: "Самарканд Шофёр (766)", phone: "+99899-766-00-58", date: "2026-07-22", amount: 1350000, city: "Самарканд", manager: "Кодир", notes: "Бугун ташаб беради | Qayta aloqa: 08.08.2026 (Menejer: Кодир)" },
      { name: "Самарканд Шофёр (588)", phone: "+99899-588-90-09", date: "2026-07-29", amount: 1150000, city: "Самарканд", manager: "Кодир", notes: "Бугун ташаб беради | Qayta aloqa: 08.08.2026 (Menejer: Кодир)" }
    ];

    // 1. Seed all 32 real debtors into Client table
    for (let i = 0; i < realDebtors.length; i++) {
      const rd = realDebtors[i];
      const dDate = new Date(rd.date);

      let client = await prisma.client.findFirst({
        where: { name: rd.name, city: rd.city }
      });

      if (client) {
        await prisma.client.update({
          where: { id: client.id },
          data: {
            name: rd.name,
            phone: rd.phone,
            city: rd.city,
            debt: rd.amount,
            debtDate: dDate,
            debtNotes: rd.notes
          }
        });
      } else {
        await prisma.client.create({
          data: {
            name: rd.name,
            phone: rd.phone,
            city: rd.city,
            debt: rd.amount,
            debtDate: dDate,
            debtNotes: rd.notes
          }
        });
      }
    }

    // Clear sample test deals ('hadiya qarzi') so they don't add 11M dummy debt
    const sampleDeals = await prisma.deal.findMany({ select: { id: true, amount: true, productName: true, notes: true } });
    for (const sd of sampleDeals) {
      const txt = `${sd.productName || ''} ${sd.notes || ''}`.toLowerCase();
      if ((txt.includes('hadiya') || txt.includes('test')) && sd.amount) {
        await prisma.deal.update({
          where: { id: sd.id },
          data: { paidAmount: sd.amount }
        });
      }
    }

    console.log('✅ 32 ta haqiqiy qarzdorlar DBga saqlandi');
  } catch (err) {
    console.log('⚠️ Real debtors migration:', err.message?.slice(0, 100));
  }

  // 9. Shofyor yo'l kirdi pullari va transport xarajatlarini avtomatik sinxronlash
  try {
    const rawDriverData = [
      { region: 'Surxondaryo', phone: '94 867 43 43', feeStr: '150000' },
      { region: 'Andijon', phone: '93 772 10 65', feeStr: '—' },
      { region: 'Farg‘ona', phone: '90 566 29 75', feeStr: '—' },
      { region: 'Navoiy Shahar', phone: '99-234-00-01', feeStr: '150000' },
      { region: 'Qo‘qon', phone: '90 855 55 56', feeStr: '0' },
      { region: 'Toshkent', phone: '95 172 33 77', feeStr: '0' },
      { region: 'Toshkent', phone: '90 000 01 67', feeStr: '50000' },
      { region: 'Qo‘qon', phone: '90 361 61 11', feeStr: '0' },
      { region: 'Buxoro', phone: '94-679-13-19', feeStr: '170000' },
      { region: 'Toshkent', phone: '50-250-53-03', feeStr: '50000' },
      { region: 'Samarqand', phone: '92-056-54-63', feeStr: '120000' },
      { region: 'Toshkent', phone: '99-993-47-22', feeStr: '100000' },
      { region: 'Toshkent', phone: '+99891-208-57-67', feeStr: '50000' },
      { region: 'Toshkent', phone: '+99897752-25-99', feeStr: '70000' },
      { region: 'Samarqand', phone: '+99894-044-82-80', feeStr: '130000' },
      { region: 'Toshkent', phone: '+99833-433-13-43', feeStr: '—' },
      { region: 'Samarqand', phone: '+99893-102-10-56', feeStr: '120000' },
      { region: 'Toshkent', phone: '+99890 588-13-50', feeStr: '—' },
      { region: 'Toshkent', phone: '+99877-978-29-39', feeStr: '60000' },
      { region: 'Buxoro', phone: '+99899-909-48-88', feeStr: '180000' },
      { region: 'Toshkent', phone: '94-648-26-36', feeStr: '50000' },
      { region: 'Toshkent', phone: '90-974-34-36', feeStr: '40000' },
      { region: 'Toshkent', phone: '93-766-61-64', feeStr: '—' },
      { region: 'Samarqand', phone: '97-958-70-07', feeStr: '130000' },
      { region: 'Jizzax', phone: '93-391-23-24', feeStr: '150000' },
      { region: 'Toshkent', phone: '99-812-60-02', feeStr: '55000' },
      { region: 'Toshkent', phone: '97-700-85-94', feeStr: '35000' },
      { region: 'Qashqadaryo', phone: '88-325-20-92', feeStr: '170000' },
      { region: 'Toshkent', phone: '99-030-08-12', feeStr: '0' },
      { region: 'Jizzax', phone: '95-961-95-55', feeStr: '150000' },
      { region: 'Samarqand', phone: '94-008-20-48', feeStr: '100000' },
      { region: 'Toshkent', phone: '95-182-87-71', feeStr: '—' },
      { region: 'Surxondaryo', phone: '94-208-84-94', feeStr: '140000' },
      { region: 'Surxondaryo', phone: '94-698-95-97', feeStr: '150000' },
      { region: 'Qashqadaryo', phone: '88-410-09-02', feeStr: '130000' },
      { region: 'Andijon', phone: '97-995-72-77', feeStr: '—' },
      { region: 'Toshkent', phone: '93-518-27-77', feeStr: '—' }
    ];

    const cleanDigits = (p) => {
      if (!p) return '';
      let digits = String(p).replace(/\D/g, '');
      if (digits.startsWith('998') && digits.length === 12) digits = digits.slice(3);
      return digits;
    };

    const allClients = await prisma.client.findMany({ select: { id: true, phone: true, city: true } });
    const allDeals = await prisma.deal.findMany({ select: { id: true, productName: true, clientId: true, driverPhone: true } });
    const existingExpenses = await prisma.expense.findMany({ where: { category: 'transport' } });

    const clientMap = new Map();
    allClients.forEach(c => {
      const d = cleanDigits(c.phone);
      if (d) {
        if (!clientMap.has(d)) clientMap.set(d, []);
        clientMap.get(d).push(c);
      }
    });

    for (const item of rawDriverData) {
      const digits = cleanDigits(item.phone);
      const amount = (item.feeStr === '—' || item.feeStr === '-' || !item.feeStr) ? 0 : Number(item.feeStr) || 0;

      const matchedClients = clientMap.get(digits) || [];
      const clientIds = new Set(matchedClients.map(c => c.id));

      const matchedDeals = allDeals.filter(d => 
        (d.clientId && clientIds.has(d.clientId)) ||
        (d.driverPhone && cleanDigits(d.driverPhone) === digits)
      );

      if (matchedDeals.length > 0) {
        for (const deal of matchedDeals) {
          await prisma.deal.update({ where: { id: deal.id }, data: { deliveryPrice: amount } });
          if (deal.clientId) {
            const cl = matchedClients.find(c => c.id === deal.clientId);
            if (cl && !cl.city) {
              await prisma.client.update({ where: { id: cl.id }, data: { city: item.region } });
            }
          }
        }
      }
    }
    console.log('✅ Shofyor yetkazib berish ma\'lumotlari yangilandi');
  } catch (err) {
    console.log('⚠️ Driver fees migration:', err.message?.slice(0, 100));
  }

  // 10. Sekvensiyalarni ma'lumotlar saqlangandan so'ng qayta tekshirib to'g'rilash
  await fixPostgresSequences(prisma);

  console.log('✅ DB migration tugadi')
}

module.exports = runMigrations
