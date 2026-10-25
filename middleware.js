const jwt = require('jsonwebtoken');
const { jwtSecret } = require('./config');

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Format: Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Access token required. Please login.' });
  }

  jwt.verify(token, jwtSecret, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token. Please login again.' });
    }
    req.user = user;
    next();
  });
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user || req.user.role !== role) {
      return res.status(403).json({ error: `Forbidden: Requires '${role}' role.` });
    }
    next();
  };
}

module.exports = {
  authenticateToken,
  requireRole
};
