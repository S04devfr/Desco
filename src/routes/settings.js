const express = require('express')
const bcrypt = require('bcryptjs')
const prisma = require('../config/database')
const { protect } = require('../middleware/auth')

const router = express.Router()
router.use(protect)

// ── COMPANY SETTINGS ──
async function getCompanySettings() {
  try {
    const settings = await prisma.companySettings.findFirst()
    return settings || { id: 1, companyName: 'DESCO CRM', currency: 'UZS', logoUrl: null }
  } catch (e) {
    return { id: 1, companyName: 'DESCO CRM', currency: 'UZS', logoUrl: null }
  }
}

router.get('/company', async (req, res, next) => {
  try {
    res.json(await getCompanySettings())
  } catch (error) { next(error) }
})

router.patch('/company', async (req, res, next) => {
  try {
    const { companyName, currency, logoUrl } = req.body
    const existing = await prisma.companySettings.findFirst()

    if (!existing) {
      await prisma.companySettings.create({
        data: {
          companyName: companyName || 'DESCO CRM',
          currency: currency || 'UZS',
          logoUrl: logoUrl !== undefined ? logoUrl : null
        }
      })
    } else {
      const data = {}
      if (companyName !== undefined) data.companyName = companyName
      if (currency !== undefined) data.currency = currency
      if (logoUrl !== undefined) data.logoUrl = logoUrl
      await prisma.companySettings.update({
        where: { id: existing.id },
        data
      })
    }
    res.json(await getCompanySettings())
  } catch (error) { next(error) }
})

// ── PROFILE ──
router.get('/profile', async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user) return res.status(404).json({ message: 'Foydalanuvchi topilmadi' })
    res.json({ id: user.id, email: user.email, fullName: user.fullName, role: user.role })
  } catch (error) { next(error) }
})

router.patch('/profile', async (req, res, next) => {
  try {
    const { fullName, email, currentPassword, newPassword } = req.body
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user) return res.status(404).json({ message: 'Foydalanuvchi topilmadi' })

    const data = {}
    if (fullName && fullName.trim()) data.fullName = fullName.trim()
    if (email && email.trim() && email !== user.email) {
      const exists = await prisma.user.findUnique({ where: { email: email.trim() } })
      if (exists) return res.status(400).json({ message: 'Bu email allaqachon band' })
      data.email = email.trim()
    }
    if (newPassword) {
      if (!currentPassword) return res.status(400).json({ message: 'Joriy parolni kiriting' })
      const ok = await bcrypt.compare(currentPassword, user.password)
      if (!ok) return res.status(400).json({ message: "Joriy parol noto'g'ri" })
      if (newPassword.length < 6) return res.status(400).json({ message: 'Yangi parol kamida 6 ta belgi' })
      data.password = await bcrypt.hash(newPassword, 10)
    }
    if (Object.keys(data).length === 0) return res.status(400).json({ message: "Hech narsa o'zgartirilmadi" })

    const updated = await prisma.user.update({ where: { id: req.userId }, data })
    req.session.user = { id: updated.id, email: updated.email, fullName: updated.fullName, role: updated.role }
    res.json({ message: 'Profil yangilandi', user: req.session.user })
  } catch (error) { next(error) }
})

// ── USERS (admin) ──
router.get('/users', async (req, res, next) => {
  try {
    // Admin bo'lmasa ham user listini qaytaramiz (deals filter uchun)
    const users = await prisma.user.findMany({
      select: { id: true, email: true, fullName: true, role: true, isActive: true, createdAt: true },
      orderBy: { createdAt: 'asc' }
    })
    res.json(users)
  } catch (error) { next(error) }
})

router.post('/users', async (req, res, next) => {
  try {
    if (req.user?.role !== 'admin') return res.status(403).json({ message: 'Faqat admin uchun' })
    const { fullName, email, password, role, isActive } = req.body
    if (!email || !password) return res.status(400).json({ message: "Email va parol majburiy" })
    if (password.length < 8) return res.status(400).json({ message: "Parol kamida 8 ta belgi bo'lishi kerak" })
    
    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) return res.status(400).json({ message: "Bu email band" })
    
    const hashedPassword = await bcrypt.hash(password, 10)
    const user = await prisma.user.create({
      data: {
        fullName,
        email,
        password: hashedPassword,
        role: role || 'manager',
        isActive: isActive !== false
      }
    })
    res.json({ message: "Foydalanuvchi qo'shildi", id: user.id })
  } catch (error) { next(error) }
})

router.patch('/users/:id', async (req, res, next) => {
  try {
    if (req.user?.role !== 'admin') return res.status(403).json({ message: 'Faqat admin uchun' })
    const { fullName, email, password, role, isActive } = req.body
    
    const data = {}
    if (fullName !== undefined) data.fullName = fullName
    if (email !== undefined) {
      const existing = await prisma.user.findFirst({ where: { email, id: { not: Number(req.params.id) } } })
      if (existing) return res.status(400).json({ message: "Bu email band" })
      data.email = email
    }
    if (password) {
      if (password.length < 8) return res.status(400).json({ message: "Parol kamida 8 ta belgi bo'lishi kerak" })
      data.password = await bcrypt.hash(password, 10)
    }
    if (role && ['admin', 'manager', 'operator'].includes(role)) data.role = role
    if (isActive !== undefined) data.isActive = isActive === true || isActive === 'true'

    const user = await prisma.user.update({
      where: { id: Number(req.params.id) },
      data,
      select: { id: true, email: true, fullName: true, role: true, isActive: true }
    })
    res.json(user)
  } catch (error) { next(error) }
})

router.delete('/users/:id', async (req, res, next) => {
  try {
    if (req.user?.role !== 'admin') return res.status(403).json({ message: 'Faqat admin uchun' })
    const id = Number(req.params.id)
    if (id === req.userId) return res.status(400).json({ message: "O'zingizni o'chira olmaysiz" })
    await prisma.user.delete({ where: { id } })
    res.json({ message: "Foydalanuvchi o'chirildi" })
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ message: 'Foydalanuvchi topilmadi' })
    next(error)
  }
})

module.exports = router
module.exports.getCompanySettings = getCompanySettings
