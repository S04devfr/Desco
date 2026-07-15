/**
 * /api/pipelines  —  Prisma ORM
 */
const express = require('express')
const { protect, requireRole } = require('../middleware/auth')
const prisma = require('../config/database')

const router = express.Router()
router.use(protect)

router.get('/', async (req, res, next) => {
  try {
    const pipelines = await prisma.pipeline.findMany({
      include: { stages: { orderBy: [{ order: 'asc' }, { id: 'asc' }] } },
      orderBy: [{ order: 'asc' }, { id: 'asc' }]
    })
    res.json(pipelines)
  } catch (err) { next(err) }
})

router.get('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    const p = await prisma.pipeline.findUnique({
      where: { id },
      include: { stages: { orderBy: [{ order: 'asc' }, { id: 'asc' }] } }
    })
    if (!p) return res.status(404).json({ message: 'Voronka topilmadi' })
    res.json(p)
  } catch (err) { next(err) }
})

router.post('/', requireRole('admin'), async (req, res, next) => {
  try {
    const { name, description, color } = req.body
    if (!name || !name.trim()) return res.status(400).json({ message: 'Voronka nomi majburiy' })
    const count = await prisma.pipeline.count()
    const isDefault = count === 0
    const p = await prisma.pipeline.create({
      data: {
        name: name.trim(),
        description: description ? description.trim() : null,
        isDefault,
        color: color || '#007AFF',
        order: count + 1
      }
    })
    await prisma.pipelineStage.createMany({
      data: [
        { name: 'Yangi',         color: '#1565C0', order: 1, isDefault: true,  pipelineId: p.id },
        { name: 'Muzokaralar',   color: '#F57F17', order: 2, isDefault: false, pipelineId: p.id },
        { name: 'Taklif',        color: '#512DA8', order: 3, isDefault: false, pipelineId: p.id },
        { name: 'Yutilgan',      color: '#2E7D32', order: 4, isDefault: false, pipelineId: p.id },
        { name: "Yo'qotilgan",   color: '#C62828', order: 5, isDefault: false, pipelineId: p.id },
      ]
    })
    const full = await prisma.pipeline.findUnique({
      where: { id: p.id },
      include: { stages: { orderBy: { order: 'asc' } } }
    })
    res.status(201).json(full)
  } catch (err) { next(err) }
})

router.patch('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    const existing = await prisma.pipeline.findUnique({ where: { id } })
    if (!existing) return res.status(404).json({ message: 'Voronka topilmadi' })
    const { name, description, color, isDefault } = req.body
    const data = {}
    if (name        !== undefined) data.name        = name.trim()
    if (description !== undefined) data.description = description ? description.trim() : null
    if (color       !== undefined) data.color       = color
    if (isDefault !== undefined) {
      if (isDefault) {
        await prisma.pipeline.updateMany({ where: { id: { not: id } }, data: { isDefault: false } })
        data.isDefault = true
      } else {
        data.isDefault = false
      }
    }
    const p = await prisma.pipeline.update({
      where: { id }, data,
      include: { stages: { orderBy: { order: 'asc' } } }
    })
    res.json(p)
  } catch (err) { next(err) }
})

router.delete('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    const existing = await prisma.pipeline.findUnique({ where: { id } })
    if (!existing) return res.status(404).json({ message: 'Voronka topilmadi' })
    const total = await prisma.pipeline.count()
    if (total <= 1) return res.status(400).json({ message: "Yagona voronkani o'chirib bo'lmaydi" })
    const other = await prisma.pipeline.findFirst({ where: { id: { not: id } }, orderBy: { order: 'asc' } })
    if (other) {
      await prisma.deal.updateMany({ where: { pipelineId: id }, data: { pipelineId: other.id } })
    }
    await prisma.pipelineStage.deleteMany({ where: { pipelineId: id } })
    await prisma.pipeline.delete({ where: { id } })
    if (existing.isDefault && other) {
      await prisma.pipeline.update({ where: { id: other.id }, data: { isDefault: true } })
    }
    res.json({ message: "Voronka o'chirildi" })
  } catch (err) { next(err) }
})

router.get('/:id/stages', async (req, res, next) => {
  try {
    const stages = await prisma.pipelineStage.findMany({
      where: { pipelineId: Number(req.params.id) },
      orderBy: [{ order: 'asc' }, { id: 'asc' }]
    })
    res.json(stages)
  } catch (err) { next(err) }
})

router.post('/:id/stages', async (req, res, next) => {
  try {
    const pid = Number(req.params.id)
    const { name, color } = req.body
    if (!name || !name.trim()) return res.status(400).json({ message: 'Bosqich nomi majburiy' })
    const agg = await prisma.pipelineStage.aggregate({ _max: { order: true }, where: { pipelineId: pid } })
    const stage = await prisma.pipelineStage.create({
      data: { name: name.trim(), color: color || '#007AFF', order: (agg._max.order || 0) + 1, isDefault: false, pipelineId: pid }
    })
    res.status(201).json(stage)
  } catch (err) { next(err) }
})

router.patch('/:pipelineId/stages/:stageId', async (req, res, next) => {
  try {
    const id = Number(req.params.stageId)
    const { name, color, order } = req.body
    const data = {}
    if (name  !== undefined) data.name  = name.trim()
    if (color !== undefined) data.color = color
    if (order !== undefined) data.order = Number(order)
    if (!Object.keys(data).length) return res.status(400).json({ message: "Hech narsa o'zgartirilmadi" })
    const stage = await prisma.pipelineStage.update({ where: { id }, data })
    res.json(stage)
  } catch (err) { next(err) }
})

router.delete('/:pipelineId/stages/:stageId', async (req, res, next) => {
  try {
    const id = Number(req.params.stageId)
    const cnt = await prisma.deal.count({ where: { stageId: id } })
    if (cnt > 0) return res.status(400).json({ message: `Bu bosqichda ${cnt} ta sdelka bor. Avval ko'chiring.` })
    await prisma.pipelineStage.delete({ where: { id } })
    res.json({ message: "Bosqich o'chirildi" })
  } catch (err) { next(err) }
})

router.post('/:id/stages/reorder', async (req, res, next) => {
  try {
    const { ids } = req.body
    if (!Array.isArray(ids)) return res.status(400).json({ message: 'ids kerak' })
    await Promise.all(ids.map((id, i) =>
      prisma.pipelineStage.update({ where: { id: Number(id) }, data: { order: i + 1 } })
    ))
    const stages = await prisma.pipelineStage.findMany({
      where: { pipelineId: Number(req.params.id) },
      orderBy: { order: 'asc' }
    })
    res.json(stages)
  } catch (err) { next(err) }
})

module.exports = router
