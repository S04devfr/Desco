const { PrismaClient } = require('@prisma/client')
const bcrypt = require('bcryptjs')
const prisma = new PrismaClient()

async function main() {
  console.log('🔄 Seeding database with rich mockup data...')

  // Clear existing data safely
  await prisma.warehouseLog.deleteMany().catch(() => {})
  await prisma.warehouseStock.deleteMany().catch(() => {})
  await prisma.instagramMessage.deleteMany().catch(() => {})
  await prisma.task.deleteMany().catch(() => {})
  await prisma.expense.deleteMany().catch(() => {})
  await prisma.activityLog.deleteMany().catch(() => {})
  await prisma.deal.deleteMany().catch(() => {})
  await prisma.client.deleteMany().catch(() => {})
  await prisma.pipelineStage.deleteMany().catch(() => {})
  await prisma.pipeline.deleteMany().catch(() => {})
  await prisma.user.deleteMany().catch(() => {})
  await prisma.companySettings.deleteMany().catch(() => {})

  // 1. Create Default Pipeline
  const pipeline = await prisma.pipeline.create({
    data: {
      name: 'Asosiy voronka',
      isDefault: true,
      color: '#007AFF',
      order: 1
    }
  })

  // 2. Create Pipeline Stages
  const stages = []
  const stageData = [
    { name: 'Yangi', color: '#1565C0', order: 1, isDefault: true },
    { name: 'Muzokaralar', color: '#F57F17', order: 2, isDefault: false },
    { name: 'Taklif', color: '#512DA8', order: 3, isDefault: false },
    { name: 'Shopirdagi pul', color: '#007AFF', order: 4, isDefault: false },
    { name: 'Nasiya Desco', color: '#34C759', order: 5, isDefault: false },
    { name: 'Nasiya Ishonch', color: '#FF9500', order: 6, isDefault: false },
    { name: 'Nasiya Baraka', color: '#FF3B30', order: 7, isDefault: false },
    { name: 'Yutilgan', color: '#2E7D32', order: 8, isDefault: false },
    { name: "Yo'qotilgan", color: '#C62828', order: 9, isDefault: false }
  ]

  for (const s of stageData) {
    const created = await prisma.pipelineStage.create({
      data: { ...s, pipelineId: pipeline.id }
    })
    stages.push(created)
  }
  console.log('✅ Pipeline stages created')

  // Hash passwords
  const adminPassword = await bcrypt.hash('Admin@123', 10)
  const managerPassword = await bcrypt.hash('Manager@123', 10)

  // 3. Create Admin Users
  const admin = await prisma.user.create({
    data: {
      fullName: 'Administrator',
      email: 'admin@desco.com',
      password: adminPassword,
      role: 'admin'
    }
  })

  const sharifjon = await prisma.user.create({
    data: {
      fullName: 'Sharifjon',
      email: 'shokirovsharifjon04@gmail.com',
      password: adminPassword,
      role: 'admin'
    }
  })

  // 4. Create Manager Users
  const mgr1 = await prisma.user.create({
    data: { fullName: 'Abdumalik', email: 'abdumalik@desco.com', password: managerPassword, role: 'manager' }
  })
  const mgr2 = await prisma.user.create({
    data: { fullName: 'Qodirjon', email: 'qodirjon@desco.com', password: managerPassword, role: 'manager' }
  })
  const mgr3 = await prisma.user.create({
    data: { fullName: 'Bekzod', email: 'bekzod@desco.com', password: managerPassword, role: 'manager' }
  })
  console.log('✅ Users seeded')

  // 5. Create Clients
  const cities = ['Toshkent', 'Qo\'qon', 'Farg\'ona', 'Andijon', 'Namangan', 'Buxoro', 'Samarqand']
  const clientsData = [
    { name: 'Aziz Karimov', phone: '+998901234567', company: 'Karimov Trading', city: 'Toshkent', ownerId: mgr1.id },
    { name: 'Dilnoza Yusupova', phone: '+998935552211', company: 'Dilnoza VIP', city: 'Qo\'qon', ownerId: mgr2.id },
    { name: 'Jasur Umarov', phone: '+998946663344', company: 'Umarov & Co', city: 'Farg\'ona', ownerId: mgr3.id },
    { name: 'Nodira Aliyeva', phone: '+998971118899', company: 'Nodira Grand', city: 'Andijon', ownerId: mgr1.id },
    { name: 'Sherzod Tojiyev', phone: '+998908887766', company: 'Tojiyev MChJ', city: 'Namangan', ownerId: mgr2.id },
    { name: 'Malika Sobirova', phone: '+998993332211', company: 'Sobirova Retail', city: 'Samarqand', ownerId: mgr3.id },
    { name: 'Bobur Mansurov', phone: '+998951110099', company: 'Mansurov B2B', city: 'Buxoro', ownerId: mgr1.id },
    { name: 'Kamola Rustamova', phone: '+998907775533', company: 'Kamola Invest', city: 'Toshkent', ownerId: mgr2.id }
  ]

  const clients = []
  for (const c of clientsData) {
    const created = await prisma.client.create({ data: c })
    clients.push(created)
  }
  console.log('✅ Clients seeded')

  // 6. Seed Warehouse Stocks
  const products = [
    'Massajor Aparati 5-in-1',
    'Massajor Pistolet (Pro)',
    'Oyoq Massajori Comfort',
    'Bel Massajori Smart',
    'Massaj Kreslosi Deluxe'
  ]

  const warehouses = ['Toshkent', 'Qo\'qon']
  for (const w of warehouses) {
    for (const p of products) {
      await prisma.warehouseStock.create({
        data: {
          warehouse: w,
          productName: p,
          stock: Math.floor(Math.random() * 40) + 20 // 20 to 60 items
        }
      })
    }
  }
  console.log('✅ Warehouse stocks seeded')

  // 7. Seed Deals (distributed across stages to make funnel complete)
  const getStageId = (name) => stages.find(s => s.name === name).id
  const dealsData = [
    // Won Deals
    { productName: 'Massajor Aparati 5-in-1', amount: 1500000, paidAmount: 1500000, status: 'won', stageId: getStageId('Yutilgan'), warehouse: 'Toshkent', clientId: clients[0].id, managerId: mgr1.id },
    { productName: 'Massajor Pistolet (Pro)', amount: 1200000, paidAmount: 1200000, status: 'won', stageId: getStageId('Yutilgan'), warehouse: 'Qo\'qon', clientId: clients[1].id, managerId: mgr2.id },
    { productName: 'Oyoq Massajori Comfort', amount: 2200000, paidAmount: 2200000, status: 'won', stageId: getStageId('Yutilgan'), warehouse: 'Toshkent', clientId: clients[2].id, managerId: mgr3.id },
    
    // Nasiya (Installment) Deals
    { productName: 'Massaj Kreslosi Deluxe', amount: 12000000, paidAmount: 4000000, status: 'won', stageId: getStageId('Nasiya Desco'), warehouse: 'Toshkent', clientId: clients[3].id, managerId: mgr1.id },
    { productName: 'Bel Massajori Smart', amount: 1800000, paidAmount: 600000, status: 'won', stageId: getStageId('Nasiya Ishonch'), warehouse: 'Qo\'qon', clientId: clients[4].id, managerId: mgr2.id },
    { productName: 'Oyoq Massajori Comfort', amount: 2200000, paidAmount: 1100000, status: 'won', stageId: getStageId('Nasiya Baraka'), warehouse: 'Toshkent', clientId: clients[5].id, managerId: mgr3.id },

    // Shipping (Shopirdagi pul)
    { productName: 'Massajor Pistolet (Pro)', amount: 1200000, paidAmount: 0, status: 'won', stageId: getStageId('Shopirdagi pul'), warehouse: 'Toshkent', clientId: clients[6].id, managerId: mgr1.id },
    { productName: 'Bel Massajori Smart', amount: 1800000, paidAmount: 0, status: 'won', stageId: getStageId('Shopirdagi pul'), warehouse: 'Qo\'qon', clientId: clients[7].id, managerId: mgr2.id },

    // Negotiation / Active Deals
    { productName: 'Massaj Kreslosi Deluxe', amount: 12000000, paidAmount: 0, status: 'new', stageId: getStageId('Muzokaralar'), warehouse: 'Toshkent', clientId: clients[0].id, managerId: mgr1.id },
    { productName: 'Massajor Aparati 5-in-1', amount: 1500000, paidAmount: 0, status: 'new', stageId: getStageId('Taklif'), warehouse: 'Qo\'qon', clientId: clients[1].id, managerId: mgr2.id },
    { productName: 'Oyoq Massajori Comfort', amount: 2200000, paidAmount: 0, status: 'new', stageId: getStageId('Yangi'), warehouse: 'Toshkent', clientId: clients[2].id, managerId: mgr3.id },

    // Canceled (Lost) Deals
    { productName: 'Massajor Pistolet (Pro)', amount: 1200000, paidAmount: 0, status: 'lost', stageId: getStageId('Yo\'qotilgan'), warehouse: 'Toshkent', clientId: clients[3].id, managerId: mgr1.id },
    { productName: 'Bel Massajori Smart', amount: 1800000, paidAmount: 0, status: 'lost', stageId: getStageId('Yo\'qotilgan'), warehouse: 'Qo\'qon', clientId: clients[4].id, managerId: mgr2.id }
  ]

  for (const d of dealsData) {
    await prisma.deal.create({
      data: {
        ...d,
        pipelineId: pipeline.id
      }
    })
  }
  console.log('✅ Deals seeded')

  // 8. Seed Marketing Expenses (Instagram Target)
  const now = new Date()
  const expData = [
    { description: 'Instagram Target Ad Campaign (June)', amount: 3500000, category: 'marketing', createdById: sharifjon.id, createdAt: new Date(now.getFullYear(), now.getMonth(), 5) },
    { description: 'Instagram Target Ad Campaign (July)', amount: 4500000, category: 'marketing', createdById: sharifjon.id, createdAt: now },
    { description: 'Ofis ijarasi va xarajatlari', amount: 2500000, category: 'office', createdById: admin.id, createdAt: now },
    { description: 'Kuryer va logistika xarajatlari', amount: 1200000, category: 'logistics', createdById: admin.id, createdAt: now }
  ]

  for (const e of expData) {
    await prisma.expense.create({ data: e })
  }
  console.log('✅ Expenses seeded')

  // 9. Seed Tasks
  await prisma.task.create({ data: { title: 'Mijoz Aziz Karimov bilan bog\'lanish', dueDate: now, dueTime: '11:00', assignedToId: mgr1.id, clientId: clients[0].id } })
  await prisma.task.create({ data: { title: 'Dilnoza Yusupovaga kurer jo\'natish', dueDate: now, dueTime: '15:30', assignedToId: mgr2.id, clientId: clients[1].id } })
  await prisma.task.create({ data: { title: 'Jasur Umarovga yangi taklif jo\'natish', dueDate: now, dueTime: '17:00', assignedToId: mgr3.id, clientId: clients[2].id } })
  console.log('✅ Tasks seeded')

  // 10. Default company settings
  await prisma.companySettings.create({
    data: { companyName: 'DESCO CRM', currency: 'UZS' }
  })

  console.log('🎉 Seeding successfully completed!')
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error('❌ Seeding failed:', e)
    await prisma.$disconnect()
    process.exit(1)
  })
