/**
 * Faqat ID 4 va 5 ni qoldirib, boshqa barcha sdelkalarni o'chiradi.
 * Ishlatish: node scripts/cleanup-deals.js
 */
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  const KEEP_IDS = [4, 5]

  const total = await prisma.deal.count()
  console.log(`Jami sdelkalar: ${total}`)

  // Bog'liq yozuvlarni tozalash
  const delAct = await prisma.activityLog.deleteMany({ where: { dealId: { notIn: KEEP_IDS } } })
  console.log(`ActivityLog o'chirildi: ${delAct.count}`)

  const delTask = await prisma.task.deleteMany({ where: { dealId: { notIn: KEEP_IDS, not: null } } })
  console.log(`Task o'chirildi: ${delTask.count}`)

  const delInst = await prisma.installment.deleteMany({ where: { dealId: { notIn: KEEP_IDS } } })
  console.log(`Installment o'chirildi: ${delInst.count}`)

  // DeliveryLog (mavjud bo'lsa)
  try {
    const delDel = await prisma.deliveryLog.deleteMany({ where: { dealId: { notIn: KEEP_IDS } } })
    console.log(`DeliveryLog o'chirildi: ${delDel.count}`)
  } catch (_) {}

  // Asosiy o'chirish
  const delDeal = await prisma.deal.deleteMany({ where: { id: { notIn: KEEP_IDS } } })
  console.log(`Sdelka o'chirildi: ${delDeal.count}`)

  // Natija
  const remaining = await prisma.deal.findMany({ select: { id: true, productName: true, amount: true, status: true } })
  console.log(`\nQolgan sdelkalar (${remaining.length} ta):`)
  remaining.forEach(d => console.log(`  #${d.id} — ${d.productName} — ${d.amount.toLocaleString()} so'm — ${d.status}`))
}

main()
  .catch(e => { console.error('Xato:', e.message); process.exit(1) })
  .finally(() => prisma.$disconnect())
