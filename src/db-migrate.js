/**
 * DB Auto-Migration — Server startupda avtomatik ishga tushadi.
 * PostgreSQL (Supabase) uchun moslashtirilgan.
 */
async function runMigrations(prisma) {
  console.log('🔧 DB migration boshlandi...')

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

  // Ensure Telegram columns exist in CompanySettings (SQLite auto-migration)
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
      { name: 'Qabul qilindi',     color: '#1565C0', order: 1 },
      { name: 'Tayyorlanmoqda',    color: '#6A1B9A', order: 2 },
      { name: "Yo'lga chiqdi",     color: '#E65100', order: 3 },
      { name: 'Yetib bordi',       color: '#2E7D32', order: 4 },
      { name: "To'lov kutilmoqda", color: '#C62828', order: 5 },
      { name: "To'lov olindi",     color: '#00796B', order: 6 },
    ]
    const DLV_NAMES = DLV_STAGES.map(s => s.name)

    // "zakaz" so'zini o'z ichiga olgan har qanday nomli pipeline
    let dlvPipeline = await prisma.pipeline.findFirst({
      where: { name: { contains: 'zakaz' } },
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
      console.log('✅ ManagerSalary va ManagerFine jadvallari yaratildi')
    } catch (err) { console.log('⚠️  ManagerSalary/Fine jadval:', err.message?.slice(0, 80)) }
  }

  // UserActivityLog — menejer online vaqtini kuzatish
  try {
    await prisma.$executeRawUnsafe(`SELECT 1 FROM "UserActivityLog" LIMIT 1`)
    console.log('✅ UserActivityLog jadvali mavjud')
  } catch (e) {
    try {
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
      console.log('✅ UserActivityLog jadvali yaratildi')
    } catch (err) { console.log('⚠️  UserActivityLog:', err.message?.slice(0, 80)) }
  }

  console.log('✅ DB migration tugadi')
}

module.exports = runMigrations
