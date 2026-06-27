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

module.exports = { protect };
