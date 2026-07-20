/**
 * Bir martalik script: zakazlar holati pipelineini to'g'ri bosqichlar bilan tuzatadi
 * Ishga tushirish: node fix-zakazlar-stages.js
 */
const { PrismaClient } = require('@prisma/client')
require('dotenv').config()

const prisma = new PrismaClient()

const DLV_STAGES = [
  { name: 'Qabul qilindi',     color: '#1565C0', order: 1 },
  { name: 'Tayyorlanmoqda',    color: '#6A1B9A', order: 2 },
  { name: "Yo'lga chiqdi",     color: '#E65100', order: 3 },
  { name: 'Yetib bordi',       color: '#2E7D32', order: 4 },
  { name: "To'lov kutilmoqda", color: '#C62828', order: 5 },
  { name: "To'lov olindi",     color: '#00796B', order: 6 },
]

async function main() {
  const pipeline = await prisma.pipeline.findFirst({
    where: { name: { contains: 'zakaz' } },
    include: { stages: true }
  })

  if (!pipeline) {
    console.log('Pipeline topilmadi. Yangisini yaratish...')
    const created = await prisma.pipeline.create({
      data: { name: 'Zakazlar Holati', isDefault: false, color: '#FF9500', order: 2 }
    })
    for (const s of DLV_STAGES) {
      await prisma.pipelineStage.create({ data: { ...s, pipelineId: created.id } })
    }
    console.log('✅ Pipeline va bosqichlari yaratildi')
    return
  }

  console.log(`Pipeline topildi: "${pipeline.name}" (id=${pipeline.id}), stages: ${pipeline.stages.length}`)
  console.log('Mavjud stages:', pipeline.stages.map(s => s.name))

  // Eski stages o'chirish
  const deleted = await prisma.pipelineStage.deleteMany({ where: { pipelineId: pipeline.id } })
  console.log(`O'chirildi: ${deleted.count} ta stage`)

  // To'g'ri stages qo'shish
  for (const s of DLV_STAGES) {
    await prisma.pipelineStage.create({ data: { ...s, pipelineId: pipeline.id } })
    console.log(`  + ${s.name}`)
  }

  // Pipeline nomini ham to'g'rilaymiz
  await prisma.pipeline.update({
    where: { id: pipeline.id },
    data: { name: 'Zakazlar Holati', color: '#FF9500' }
  })

  console.log('\n✅ Tayyor! Brauzerda sahifani yangilang.')
}

main()
  .catch(e => { console.error('Xato:', e.message); process.exit(1) })
  .finally(() => prisma.$disconnect())
