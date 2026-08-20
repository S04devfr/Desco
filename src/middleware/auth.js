const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const prisma = require('../config/database');

// SECURITY: JWT secret ni markazlashtirilgan holda boshqarish
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.warn('[⚠ SECURITY] auth middleware: JWT_SECRET is missing or weak.');
}
const EFFECTIVE_JWT_SECRET = JWT_SECRET || crypto.randomBytes(64).toString('hex');

// Protect routes - require authentication
const protect = async (req, res, next) => {
  // Check session
  if (req.session && req.session.userId) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.session.userId },
        select: { id: true, email: true, password: true, fullName: true, role: true, isActive: true }
      });

      if (!user || !user.isActive) {
        req.session.destroy(() => {});
        res.clearCookie('connect.sid');
        res.clearCookie('__desco_sid');
        return res.status(401).json({ message: 'Unauthorized - Sessiya tugagan' });
      }

      if (req.session.passwordHash && req.session.passwordHash !== user.password) {
        req.session.destroy(() => {});
        res.clearCookie('connect.sid');
        res.clearCookie('__desco_sid');
        return res.status(401).json({ message: 'Unauthorized - Parol o\'zgargan' });
      }

      req.session.passwordHash = user.password;
      req.userId = user.id;
      req.user = {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role
      };
      return next();
    } catch (err) {
      return res.status(500).json({ message: 'Auth middleware xatoligi' });
    }
  }

  // Check JWT token in header
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Unauthorized - No token provided' });
  }

  try {
    const decoded = jwt.verify(token, EFFECTIVE_JWT_SECRET);
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: { id: true, email: true, password: true, fullName: true, role: true, isActive: true }
    });

    if (!user || !user.isActive || (decoded.passwordHash && decoded.passwordHash !== user.password)) {
      return res.status(401).json({ message: 'Unauthorized - Sessiya tugagan yoki parol o\'zgargan' });
    }

    req.userId = user.id;
    req.user = {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role
    };
    next();
  } catch (error) {
    res.status(401).json({ message: 'Unauthorized - Invalid token' });
  }
};

// Rol tekshirish middleware
const requireRole = (...roles) => {
  return (req, res, next) => {
    const userRole = req.user?.role || req.session?.user?.role;
    if (!userRole) {
      if (req.accepts('html') && !req.xhr) return res.redirect('/login');
      return res.status(401).json({ message: 'Unauthorized' });
    }
    if (!roles.includes(userRole)) {
      if (req.accepts('html') && !req.xhr) {
        return res.status(403).send(`
          <div style="text-align:center; padding: 50px; font-family: sans-serif;">
            <h1>403 Forbidden</h1>
            <p>Bu sahifaga kirishga ruxsatingiz yo'q</p>
            <a href="/">Bosh sahifaga qaytish</a>
          </div>
        `);
      }
      return res.status(403).json({ message: "Bu sahifaga kirishga ruxsatingiz yo'q" });
    }
    next();
  };
};

module.exports = { protect, requireRole };
