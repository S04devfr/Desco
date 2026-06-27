const { PrismaClient } = require('@prisma/client')
const bcrypt = require('bcryptjs')
const prisma = new PrismaClient()

async function main() {
  // Avval bazani tozalash (tartib: bog'liqlik bo'yicha)
  await prisma.instagramMessage.deleteMany()
  await prisma.task.deleteMany()
  await prisma.expense.deleteMany()
  await prisma.activityLog.deleteMany()
  await prisma.deal.deleteMany()
  await prisma.client.deleteMany()
  await prisma.pipelineStage.deleteMany()
  await prisma.pipeline.deleteMany()
  await prisma.user.deleteMany()
  await prisma.companySettings.deleteMany()

  // Default pipeline yaratish
  const pipeline = await prisma.pipeline.create({
    data: {
      name: 'Asosiy voronka',
      isDefault: true,
      color: '#007AFF',
      order: 1
    }
  })

  // Default pipeline bosqichlari
  const stages = await Promise.all([
    prisma.pipelineStage.create({
      data: { name: 'Yangi', color: '#1565C0', order: 1, isDefault: true, pipelineId: pipeline.id }
    }),
    prisma.pipelineStage.create({
      data: { name: 'Muzokaralar', color: '#F57F17', order: 2, isDefault: false, pipelineId: pipeline.id }
    }),
    prisma.pipelineStage.create({
      data: { name: 'Taklif', color: '#512DA8', order: 3, isDefault: false, pipelineId: pipeline.id }
    }),
    prisma.pipelineStage.create({
      data: { name: 'Yutilgan', color: '#2E7D32', order: 4, isDefault: false, pipelineId: pipeline.id }
    }),
    prisma.pipelineStage.create({
      data: { name: "Yo'qotilgan", color: '#C62828', order: 5, isDefault: false, pipelineId: pipeline.id }
    }),
  ])
  console.log('✅ Pipeline va stages yaratildi')

  const adminPassword = await bcrypt.hash('Admin@123', 10)
  const managerPassword = await bcrypt.hash('Manager@123', 10)

  // Admin foydalanuvchi qo'shish
  const admin = await prisma.user.create({
    data: {
      fullName: 'Admin',
      email: 'admin@desco.com',
      password: adminPassword,
      role: 'admin'
    }
  })

  // Manager foydalanuvchilar qo'shish
  const manager1 = await prisma.user.create({
    data: {
      fullName: 'Abdumalik',
      email: 'abdumalik@desco.com',
      password: managerPassword,
      role: 'manager'
    }
  })

  const manager2 = await prisma.user.create({
    data: {
      fullName: 'Qodirjon',
      email: 'qodirjon@desco.com',
      password: managerPassword,
      role: 'manager'
    }
  })

  // Mijozlar
  const client1 = await prisma.client.create({
    data: { name: 'Aziz Karimov', phone: '+998901234567', email: 'aziz@example.com', company: 'Aziz LLC', ownerId: manager1.id }
  })

  const client2 = await prisma.client.create({
    data: { name: 'Dilnoza Yusupova', phone: '+998901112233', email: 'dilnoza@example.com', company: 'Dilnoza Trade', ownerId: manager2.id }
  })

  // Sdelkalar (Prisma ORM orqali — SQLite raw query emas)
  const deal1 = await prisma.deal.create({
    data: {
      productName: 'Noutbuk',
      amount: 8000000,
      paidAmount: 8000000,
      status: 'won',
      clientId: client1.id,
      managerId: manager1.id,
      stageId: stages[3].id,      // Yutilgan
      pipelineId: pipeline.id
    }
  })

  const deal2 = await prisma.deal.create({
    data: {
      productName: 'Telefon',
      amount: 4500000,
      paidAmount: 2000000,
      status: 'new',
      clientId: client2.id,
      managerId: manager2.id,
      stageId: stages[1].id,      // Muzokaralar
      pipelineId: pipeline.id
    }
  })

  const deal3 = await prisma.deal.create({
    data: {
      productName: 'Monitor',
      amount: 1500000,
      paidAmount: 1500000,
      status: 'won',
      clientId: client1.id,
      managerId: manager1.id,
      stageId: stages[2].id,      // Taklif
      pipelineId: pipeline.id
    }
  })

  // Xarajatlar
  await prisma.expense.create({
    data: { description: 'Yoqilg\'i', amount: 300000, category: 'logistics', createdById: admin.id }
  })

  await prisma.expense.create({
    data: { description: 'Ofis ijarasi', amount: 1000000, category: 'office', createdById: admin.id }
  })

  // Vazifalar
  const today = new Date()
  today.setHours(18, 0, 0, 0)

  await prisma.task.create({
    data: { title: 'Aziz bilan bog\'lanish', dueDate: today, dueTime: '18:00', assignedToId: manager1.id }
  })

  await prisma.task.create({
    data: { title: 'Dilnoza uchun hujjat tayyorlash', dueDate: today, dueTime: '17:00', assignedToId: manager2.id }
  })

  // Default company settings
  await prisma.companySettings.create({
    data: { companyName: 'DESCO CRM', currency: 'UZS' }
  })
}

main()
  .then(() => {
    console.log('✅ db seeding completed')
  })
  .catch((e) => {
    console.error('❌ db seeding failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
