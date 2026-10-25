const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();
const { pool } = require('./db');

// In-memory storage for verification diagnostics
global.verificationDiagnostics = [];
global.youtubeApiStatus = {
  status: process.env.YOUTUBE_API_KEY ? 'Configured' : 'Missing API Key',
  lastAttempt: null,
  lastResponseStatus: null
};
global.facebookApiStatus = {
  status: process.env.FACEBOOK_PAGE_ACCESS_TOKEN ? 'Configured' : 'Missing Token',
  lastAttempt: null,
  lastResponseStatus: null
};
global.MANUAL_AUDIT_PERCENTAGE = process.env.MANUAL_AUDIT_PERCENTAGE ? parseInt(process.env.MANUAL_AUDIT_PERCENTAGE, 10) : 25;
const authRouter = require('./routes/auth');
const adminRouter = require('./routes/admin');
const studentRouter = require('./routes/student');

const app = express();
const PORT = process.env.PORT || 3000;
const allowedOrigins = (process.env.FRONTEND_ORIGINS || `http://localhost:${PORT},http://127.0.0.1:${PORT}`)
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

// Middleware
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});
app.use(cors({
  origin: (origin, callback) => {
    callback(null, !origin || allowedOrigins.includes(origin));
  },
  credentials: true
}));
app.use(express.json({ limit: '100kb' }));

// Log incoming requests for development debugging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Serve static frontend assets from /public folder
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/student', studentRouter);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date() });
});

app.get('/api/system/youtube-status', async (req, res) => {
  try {
    const quotaResult = await pool.query("SELECT COALESCE(SUM(quota_cost), 0) AS used_today FROM youtube_api_usage WHERE DATE(created_at) = CURRENT_DATE");
    const lastReqResult = await pool.query("SELECT status, response_code, created_at FROM youtube_api_usage ORDER BY created_at DESC LIMIT 1");
    
    const usedToday = parseInt(quotaResult.rows[0].used_today, 10);
    const lastReq = lastReqResult.rows.length > 0 ? lastReqResult.rows[0] : null;

    res.json({
      envKeyPresent: !!process.env.YOUTUBE_API_KEY,
      verificationMode: process.env.YOUTUBE_API_KEY ? "REAL_API" : "MOCK",
      startupDetectedKey: global.youtubeApiStatus.status === 'Configured',
      quota: {
        usedToday: usedToday,
        remaining: 10000 - usedToday,
        percentage: ((usedToday / 10000) * 100).toFixed(2)
      },
      lastRequest: lastReq ? {
        status: lastReq.status,
        responseCode: lastReq.response_code,
        timestamp: lastReq.created_at
      } : null
    });
  } catch (error) {
    console.error('Error fetching youtube status:', error);
    res.status(500).json({ error: 'Failed to retrieve youtube status.' });
  }
});

// Meta Compliance Pages (Privacy, Terms, Data Deletion)
app.get('/privacy', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'privacy.html'));
});
app.get('/terms', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'terms.html'));
});
app.get('/delete-data', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'delete-data.html'));
});

// Fallback to landing page for undefined routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server after database check
const fs = require('fs');

async function checkAndInitializeDatabase() {
  try {
    // Seed only a new database; an empty users table can still belong to an existing dataset.
    const tableCheck = await pool.query(`
      SELECT COUNT(*)::int AS count
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('users', 'tasks');
    `);
    const isUninitialized = tableCheck.rows[0].count === 0;

    const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await pool.query(schemaSql);
    console.log(isUninitialized ? 'Database tables initialized.' : 'Database schema checked without dropping existing data.');

    if (isUninitialized) {
      const seedSql = fs.readFileSync(path.join(__dirname, 'seed.sql'), 'utf8');
      await pool.query(seedSql);
      console.log('Sample data seeded successfully.');
    }

    console.log('Ensuring database constraints are up-to-date...');
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS facebook_display_name VARCHAR(255) DEFAULT NULL;`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS supabase_user_id UUID UNIQUE;`);
    await pool.query(`ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;`);
    await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS points INTEGER NOT NULL DEFAULT 10;`);
    await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'CREATED';`);
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'tasks'::regclass AND conname = 'tasks_points_range_check'
        ) THEN
          ALTER TABLE tasks ADD CONSTRAINT tasks_points_range_check CHECK (points BETWEEN 0 AND 10000);
        END IF;
      END $$;
    `);
    await pool.query(`
      ALTER TABLE users ENABLE ROW LEVEL SECURITY;
      ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
      ALTER TABLE task_engagements ENABLE ROW LEVEL SECURITY;
      ALTER TABLE identity_snapshots ENABLE ROW LEVEL SECURITY;
      ALTER TABLE student_activities ENABLE ROW LEVEL SECURITY;
      ALTER TABLE manual_audits ENABLE ROW LEVEL SECURITY;
      ALTER TABLE review_logs ENABLE ROW LEVEL SECURITY;
      ALTER TABLE manual_audit_history ENABLE ROW LEVEL SECURITY;
      ALTER TABLE verification_audit_logs ENABLE ROW LEVEL SECURITY;
      ALTER TABLE youtube_api_usage ENABLE ROW LEVEL SECURITY;
      ALTER TABLE facebook_api_usage ENABLE ROW LEVEL SECURITY;
    `);
    console.log('Database constraints verified.');
  } catch (error) {
    console.error('Error during database startup initialization check:', error);
    throw error;
  }
}

async function startServer() {
  try {
    await checkAndInitializeDatabase();
    app.listen(PORT, () => {
    console.log(`=========================================`);
    console.log(` EngageHub MVP Server started on port ${PORT}`);
    console.log(` Local link: http://localhost:${PORT}`);
    
    console.log(`\\n[STARTUP DIAGNOSTIC]`);
    console.log(`YOUTUBE_API_KEY Present: ${!!process.env.YOUTUBE_API_KEY ? 'TRUE' : 'FALSE'}`);
    
    // Validate YouTube API Key configuration
    if (process.env.YOUTUBE_API_KEY) {
      console.log(` YouTube API Status: Configured`);
    } else {
      console.log(` YouTube API Status: Missing API Key`);
      console.warn(` [WARNING] YouTube Comment Verification will fail with Configuration Error.`);
    }
    
    console.log(`FACEBOOK_PAGE_ACCESS_TOKEN Present: ${!!process.env.FACEBOOK_PAGE_ACCESS_TOKEN ? 'TRUE' : 'FALSE'}`);
    if (process.env.FACEBOOK_PAGE_ACCESS_TOKEN) {
      console.log(` Facebook API Status: Configured`);
    } else {
      console.log(` Facebook API Status: Missing Token`);
      console.warn(` [WARNING] Facebook Comment Verification will fail with Configuration Error.`);
    }
    
    console.log(`=========================================`);
    });
  } catch (error) {
    console.error('Server startup failed; refusing to listen with an uninitialized database:', error);
    await pool.end();
    process.exitCode = 1;
  }
}

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer };
