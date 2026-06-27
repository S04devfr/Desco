const express = require('express')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const prisma = require('../config/database')
const { protect } = require('../middleware/auth')

const router = express.Router()

function buildUserPayload(user) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role
  }
}

// Register route
router.post('/register', async (req, res, next) => {
  try {
    const { email, password, fullName, role } = req.body

    if (!email || !password) {
      return res.status(400).json({ message: 'Email va parol majburiy' })
    }

    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
      return res.status(409).json({ message: 'Bu email allaqachon ro\'yxatdan o\'tgan' })
    }

    const hashedPassword = await bcrypt.hash(password, 10)

    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        fullName: fullName || email.split('@')[0],
        role: role === 'admin' ? 'admin' : 'manager'
      }
    })

    const payload = buildUserPayload(user)
    req.session.userId = user.id
    req.session.user = payload

    res.status(201).json({ message: 'Ro\'yxatdan o\'tish muvaffaqiyatli', user: payload })
  } catch (error) {
    next(error)
  }
})

// Login route
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body

    if (!email || !password) {
      return res.status(400).json({ message: 'Email va parol majburiy' })
    }

    const user = await prisma.user.findUnique({ where: { email } })
    if (!user) {
      return res.status(401).json({ message: 'Email yoki parol noto\'g\'ri' })
    }

    const isMatch = await bcrypt.compare(password, user.password)
    if (!isMatch) {
      return res.status(401).json({ message: 'Email yoki parol noto\'g\'ri' })
    }

    const payload = buildUserPayload(user)

    req.session.userId = user.id
    req.session.user = payload

    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRY || '7d'
    })

    res.json({ message: 'Kirish muvaffaqiyatli', user: payload, token })
  } catch (error) {
    next(error)
  }
})

// Logout route
router.post('/logout', (req, res, next) => {
  if (!req.session) {
    return res.json({ message: 'Chiqish muvaffaqiyatli' })
  }
  req.session.destroy((err) => {
    if (err) return next(err)
    res.clearCookie('connect.sid')
    res.json({ message: 'Chiqish muvaffaqiyatli' })
  })
})

// Current user
router.get('/me', protect, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user) {
      return res.status(404).json({ message: 'Foydalanuvchi topilmadi' })
    }
    res.json({ user: buildUserPayload(user) })
  } catch (error) {
    next(error)
  }
})

module.exports = router

// GET /auth/logout (page redirect)
router.get('/logout', (req, res) => {
  if (req.session) req.session.destroy(() => {})
  res.clearCookie('connect.sid')
  res.redirect('/login')
})

// Change password
router.post('/change-password', protect, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body
    if (!currentPassword || !newPassword) return res.status(400).json({ message: 'Barcha maydonlar majburiy' })
    if (newPassword.length < 6) return res.status(400).json({ message: 'Parol kamida 6 ta belgi' })

    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user) return res.status(404).json({ message: 'Foydalanuvchi topilmadi' })

    const isMatch = await bcrypt.compare(currentPassword, user.password)
    if (!isMatch) return res.status(401).json({ message: "Joriy parol noto'g'ri" })

    const hashed = await bcrypt.hash(newPassword, 10)
    await prisma.user.update({ where: { id: req.userId }, data: { password: hashed } })
    res.json({ message: "Parol muvaffaqiyatli o'zgartirildi" })
  } catch (error) { next(error) }
})
