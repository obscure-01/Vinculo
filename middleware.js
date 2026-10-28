const supabaseAuth = require('./supabaseAuth');
const db = require('./db');

function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length).trim()
    : null;

  if (!token) {
    return res.status(401).json({ error: 'Access token required. Please login.' });
  }

  supabaseAuth.auth.getUser(token).then(async ({ data, error }) => {
    if (error || !data.user) {
      return res.status(401).json({ error: 'Invalid or expired token. Please login again.' });
    }

    const result = await db.query(
      'SELECT id, name, email, role, points FROM users WHERE supabase_user_id = $1',
      [data.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(403).json({ error: 'Your Supabase account is not linked to a Vinculo profile.' });
    }

    req.user = result.rows[0];
    next();
  }).catch(error => {
    console.error('Supabase token verification error:', error);
    res.status(401).json({ error: 'Unable to verify access token.' });
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
