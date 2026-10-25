require('dotenv').config();

const jwtSecret = process.env.JWT_SECRET;

if (!jwtSecret) {
  throw new Error('JWT_SECRET must be configured before the application can start.');
}

module.exports = { jwtSecret };
