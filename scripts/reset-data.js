/**
 * Barcha ma'lumotlarni tozalash (foydalanuvchilar, pipeline va sozlamalar saqlanadi)
 * Ishlatish: node scripts/reset-data.js
 */
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  console.log('🗑  Ma\'lumotlar tozalanmoqda...\n')

  // Tartib muhim — FK bog'liqliklari
  const steps = [
    ['ActivityLog',    () => prisma.activityLog.deleteMany()],
    ['DeliveryLog',    () => prisma.deliveryLog.deleteMany().catch(() => ({ count: 0 }))],
    ['Task',           () => prisma.task.deleteMany()],
    ['Installment',    () => prisma.installment.deleteMany()],
    ['Deal',           () => prisma.deal.deleteMany()],
    ['Client',         () => prisma.client.deleteMany()],
    ['Expense',        () => prisma.expense.deleteMany()],
    ['MarketingLog',   () => prisma.marketingLog.deleteMany()],
    ['ManagerFine',    () => prisma.managerFine.deleteMany()],
    ['ManagerSalary',  () => prisma.managerSalary.deleteMany()],
    ['WarehouseLog',   () => prisma.warehouseLog.deleteMany()],
    ['WarehouseStock', () => prisma.warehouseStock.deleteMany()],
    ['InstagramMessage', () => prisma.instagramMessage.deleteMany().catch(() => ({ count: 0 }))],
  ]

  for (const [name, fn] of steps) {
    const r = await fn()
    console.log(`  ✅ ${name}: ${r.count} ta o'chirildi`)
  }

  console.log('\n✅ Hammasi tozalandi. Endi yangi ma\'lumotlar qo\'sha olasiz.')
}

main()
  .catch(e => { console.error('❌ Xato:', e.message); process.exit(1) })
  .finally(() => prisma.$disconnect())
