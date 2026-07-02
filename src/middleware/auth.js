const jwt = require('jsonwebtoken');

// Protect routes - require authentication
const protect = (req, res, next) => {
  // Check session
  if (req.session && req.session.userId) {
    req.userId = req.session.userId;
    req.user = req.session.user;
    return next();
  }

  // Check JWT token in header
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ message: 'Unauthorized - No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.id;
    req.user = decoded;
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
