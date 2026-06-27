/**
 * /api/pipeline-stages  —  Prisma ORM
 */
const express = require('express')
const { protect } = require('../middleware/auth')
const prisma = require('../config/database')

const router = express.Router()
router.use(protect)

async function getDefaultPipelineId() {
  const p = await prisma.pipeline.findFirst({ where: { isDefault: true }, orderBy: [{ order: 'asc' }, { id: 'asc' }] })
    || await prisma.pipeline.findFirst({ orderBy: [{ order: 'asc' }, { id: 'asc' }] })
  return p ? p.id : null
}

async function getStages(pipelineId) {
  const where = pipelineId ? { pipelineId: Number(pipelineId) } : {}
  return prisma.pipelineStage.findMany({ where, orderBy: [{ order: 'asc' }, { id: 'asc' }] })
}

router.get('/', async (req, res, next) => {
  try {
    const pipelineId = req.query.pipelineId ? Number(req.query.pipelineId) : await getDefaultPipelineId()
    res.json(await getStages(pipelineId))
  } catch (err) { next(err) }
})

router.post('/', async (req, res, next) => {
  try {
    const { name, color, order, pipelineId } = req.body
    if (!name || !name.trim()) return res.status(400).json({ message: 'Bosqich nomi majburiy' })
    const pid = pipelineId ? Number(pipelineId) : await getDefaultPipelineId()
    const agg = await prisma.pipelineStage.aggregate({ _max: { order: true }, where: { pipelineId: pid } })
    const ord = order !== undefined ? Number(order) : (agg._max.order || 0) + 1
    const stage = await prisma.pipelineStage.create({
      data: { name: name.trim(), color: color || '#5D4037', order: ord, isDefault: false, pipelineId: pid }
    })
    res.status(201).json(stage)
  } catch (err) { next(err) }
})

router.patch('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    const existing = await prisma.pipelineStage.findUnique({ where: { id } })
    if (!existing) return res.status(404).json({ message: 'Bosqich topilmadi' })
    const { name, color, order } = req.body
    const data = {}
    if (name  !== undefined) data.name  = name.trim()
    if (color !== undefined) data.color = color
    if (order !== undefined) data.order = Number(order)
    const stage = await prisma.pipelineStage.update({ where: { id }, data })
    res.json(stage)
  } catch (err) { next(err) }
})

router.delete('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    const cnt = await prisma.deal.count({ where: { stageId: id } })
    if (cnt > 0) return res.status(400).json({ message: `Bu bosqichda ${cnt} ta sdelka bor. Avval ko'chiring.` })
    await prisma.pipelineStage.delete({ where: { id } })
    res.json({ message: "Bosqich o'chirildi" })
  } catch (err) { next(err) }
})

router.post('/reorder', async (req, res, next) => {
  try {
    const { ids } = req.body
    if (!Array.isArray(ids)) return res.status(400).json({ message: 'ids array kerak' })
    await Promise.all(ids.map((id, i) =>
      prisma.pipelineStage.update({ where: { id: Number(id) }, data: { order: i + 1 } })
    ))
    const pipelineId = await getDefaultPipelineId()
    res.json(await getStages(pipelineId))
  } catch (err) { next(err) }
})

module.exports = router
module.exports.getStages = getStages
module.exports.getDefaultPipelineId = getDefaultPipelineId
