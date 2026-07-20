/**
 * Suniy ma'lumotlar kiritish skripti
 * Ishlatish: node seed-data.js
 */
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

const clients = [
  { name: 'Jasur Karimov',     phone: '+998901234567', city: 'Toshkent',   company: 'Karimov Trading' },
  { name: 'Nilufar Rashidova', phone: '+998912345678', city: 'Samarqand',  company: 'Rashid Group' },
  { name: 'Bobur Toshmatov',   phone: '+998923456789', city: 'Namangan',   company: null },
  { name: 'Malika Yusupova',   phone: '+998934567890', city: 'Andijon',    company: 'Yusup Store' },
  { name: 'Sardor Axmedov',    phone: '+998945678901', city: 'Farg\'ona',  company: 'Axmed LLC' },
  { name: 'Zulfiya Normatova', phone: '+998956789012', city: 'Buxoro',     company: null },
  { name: 'Otabek Holiqov',    phone: '+998967890123', city: 'Toshkent',   company: 'Holiq Servis' },
  { name: 'Dilorom Sultonova', phone: '+998978901234', city: 'Qarshi',     company: null },
  { name: 'Sherzod Mirzayev',  phone: '+998989012345', city: 'Nukus',      company: 'Mirza Import' },
  { name: 'Feruza Qodirov',    phone: '+998990123456', city: 'Toshkent',   company: 'Qodir Optom' },
  { name: 'Ulugbek Ergashev',  phone: '+998901111222', city: 'Jizzax',     company: null },
  { name: 'Mohira Baxtiyorova',phone: '+998912222333', city: 'Samarqand',  company: 'Baxt Market' },
  { name: 'Nozim Xasanov',     phone: '+998923333444', city: 'Toshkent',   company: 'Xasan Trade' },
  { name: 'Gulnora Sodiqova',  phone: '+998934444555', city: 'Andijon',    company: null },
  { name: 'Hamidjon Raximov',  phone: '+998945555666', city: 'Namangan',   company: 'Raxim Optom' },
]

const products = [
  'Hisob-kitob dasturi',
  'CRM tizimi',
  'Mobil ilova',
  'Web-sayt yaratish',
  'SEO xizmati',
  'Reklama kampaniyasi',
  'Logistika tizimi',
  'Omborxona dasturi',
  'Moliya hisoboti',
  'HR tizimi',
]

async function main() {
  console.log('🌱 Ma\'lumotlar kiritilmoqda...\n')

  // Admin userni olish
  const admin = await prisma.user.findFirst({ where: { role: 'admin' } })
  if (!admin) {
    console.log('❌ Admin topilmadi. Avval server\'ni ishga tushiring.')
    return
  }
  console.log(`✅ Admin: ${admin.fullName || admin.email}`)

  // Pipelinelarni olish
  const pipelines = await prisma.pipeline.findMany({ include: { stages: { orderBy: { order: 'asc' } } } })
  if (!pipelines.length) {
    console.log('❌ Pipeline topilmadi. Avval server\'ni ishga tushiring.')
    return
  }
  console.log(`✅ ${pipelines.length} ta pipeline topildi`)

  // Clientlarni yaratish
  console.log('\n👥 Clientlar yaratilmoqda...')
  const createdClients = []
  for (const c of clients) {
    const existing = await prisma.client.findFirst({ where: { phone: c.phone } })
    if (existing) {
      createdClients.push(existing)
      continue
    }
    const client = await prisma.client.create({
      data: { ...c, ownerId: admin.id }
    })
    createdClients.push(client)
    console.log(`  + ${client.name} (${client.city})`)
  }
  console.log(`✅ ${createdClients.length} ta client`)

  // Har pipeline uchun deallar yaratish
  console.log('\n📊 Deallar yaratilmoqda...')
  let dealCount = 0

  for (const pipeline of pipelines) {
    const stages = pipeline.stages
    if (!stages.length) continue

    // Har stage uchun 2-3 ta deal
    for (let si = 0; si < stages.length; si++) {
      const stage = stages[si]
      const dealsPerStage = si === 0 ? 3 : si === stages.length - 1 ? 1 : 2

      for (let d = 0; d < dealsPerStage; d++) {
        const client = createdClients[Math.floor(Math.random() * createdClients.length)]
        const product = products[Math.floor(Math.random() * products.length)]
        const amount = Math.round((Math.random() * 45 + 5) * 100000) // 500k - 5mln
        const paidAmount = si > stages.length / 2 ? Math.round(amount * (Math.random() * 0.5 + 0.3)) : 0

        await prisma.deal.create({
          data: {
            productName: product,
            amount,
            paidAmount,
            status: 'new',
            clientId: client.id,
            managerId: admin.id,
            stageId: stage.id,
            pipelineId: pipeline.id,
            notes: `${client.city}dan kelgan mijoz. ${product} uchun muzokaralar olib borilmoqda.`,
          }
        })
        dealCount++
      }
    }
  }
  console.log(`✅ ${dealCount} ta deal`)

  // Xarajatlar
  console.log('\n💸 Xarajatlar kiritilmoqda...')
  const expenses = [
    { description: 'Ofis ijarasi', amount: 3500000, category: 'rent' },
    { description: 'Internet va telefon', amount: 450000, category: 'utilities' },
    { description: 'Xodimlar maoshi', amount: 12000000, category: 'salary' },
    { description: 'Reklama (Instagram)', amount: 2000000, category: 'marketing' },
    { description: 'Ofis jihozlari', amount: 1800000, category: 'equipment' },
    { description: 'Transport xarajatlari', amount: 750000, category: 'transport' },
    { description: 'Kommunal to\'lovlar', amount: 380000, category: 'utilities' },
    { description: 'Dasturiy ta\'minot', amount: 600000, category: 'software' },
  ]

  const now = new Date()
  for (const exp of expenses) {
    const daysAgo = Math.floor(Math.random() * 30)
    const date = new Date(now)
    date.setDate(date.getDate() - daysAgo)
    await prisma.expense.create({
      data: { ...exp, date, createdById: admin.id }
    })
    console.log(`  + ${exp.description}: ${(exp.amount/1000000).toFixed(1)}M so'm`)
  }

  // Vazifalar
  console.log('\n📝 Vazifalar kiritilmoqda...')
  const tasks = [
    { title: 'Jasur Karimov bilan uchrashuv', priority: 'high' },
    { title: 'Shartnoma tayyorlash', priority: 'high' },
    { title: 'Hisobot yuborish', priority: 'medium' },
    { title: 'Yangi mijozga taqdimot', priority: 'medium' },
    { title: 'To\'lovni tekshirish', priority: 'low' },
    { title: 'SMS xabar yuborish', priority: 'low' },
  ]

  for (const t of tasks) {
    const dueDate = new Date()
    dueDate.setDate(dueDate.getDate() + Math.floor(Math.random() * 7 + 1))
    await prisma.task.create({
      data: { ...t, assignedToId: admin.id, dueDate }
    })
    console.log(`  + ${t.title}`)
  }

  console.log('\n🎉 Barcha ma\'lumotlar muvaffaqiyatli kiritildi!')
  console.log(`   👥 ${createdClients.length} ta client`)
  console.log(`   📊 ${dealCount} ta deal`)
  console.log(`   💸 ${expenses.length} ta xarajat`)
  console.log(`   📝 ${tasks.length} ta vazifa`)
}

main()
  .catch(e => console.error('Xato:', e.message))
  .finally(() => prisma.$disconnect())
