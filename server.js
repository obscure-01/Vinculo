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

// Middleware
app.use(cors());
app.use(express.json());

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

// Fallback to landing page for undefined routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server after database check
const fs = require('fs');

async function checkAndInitializeDatabase() {
  try {
    // Check if the users table exists in public schema
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
          AND table_name = 'users'
      );
    `);
    
    let isEmpty = !tableCheck.rows[0].exists;
    
    if (!isEmpty) {
      const countCheck = await pool.query('SELECT COUNT(*)::int FROM users');
      if (countCheck.rows[0].count === 0) {
        isEmpty = true;
      }
    }

    if (isEmpty) {
      console.log('Database is empty. Initializing schema and seed data...');
      
      // Read and run schema.sql
      const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
      await pool.query(schemaSql);
      console.log('Database tables initialized.');

      // Read and run seed.sql
      const seedSql = fs.readFileSync(path.join(__dirname, 'seed.sql'), 'utf8');
      await pool.query(seedSql);
      console.log('Sample data seeded successfully.');
    } else {
      console.log('Database already initialized. Connecting and loading records...');
    }

    // Ensure the CHECK constraint is updated to support the new comment status values
    console.log('Ensuring database constraints are up-to-date...');
    
    // Auto-migrate new columns and tables for V4 update if they don't exist
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS facebook_display_name VARCHAR(255) DEFAULT NULL;`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS facebook_api_usage (
        id SERIAL PRIMARY KEY,
        request_type VARCHAR(255) NOT NULL,
        quota_cost INTEGER NOT NULL DEFAULT 0,
        status VARCHAR(50) NOT NULL,
        response_code INTEGER,
        error_message TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    await pool.query(`
      ALTER TABLE task_activity DROP CONSTRAINT IF EXISTS task_activity_comment_status_check;
      ALTER TABLE task_activity ADD CONSTRAINT task_activity_comment_status_check CHECK (
        comment_status IN ('Not Checked', 'Comment Verified', 'Comment Not Found', 'YouTube Account Not Available', 'Verification Error', 'Not Attempted', 'Comment Detected', 'Comment Not Verified', 'Platform Not Available', 'Invalid URL', 'Video ID Extraction Failed', 'Video Not Found', 'Handle Mismatch', 'Verification Successful', 'Student Handle Missing', 'Comments Not Accessible', 'No Comments Retrieved', 'Configuration Error', 'Comments Disabled', 'API Quota Exceeded', 'API Not Enabled', 'API Key Invalid', 'Network Error', 'No Comments Available', 'Facebook Account Not Available', 'Post ID Extraction Failed', 'Post Not Found', 'Facebook API Error', 'Rate Limited')
      );
    `);
    
    // Auto-migrate Manual Audit System
    await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS verification_method VARCHAR(50) DEFAULT 'AUTOMATIC';`);
    await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS engagement_type VARCHAR(50) DEFAULT 'COMMENT';`);
    
    // Explicit migration: ensure historical records have valid values
    await pool.query(`UPDATE tasks SET verification_method = 'AUTOMATIC' WHERE verification_method IS NULL;`);
    await pool.query(`UPDATE tasks SET engagement_type = 'COMMENT' WHERE engagement_type IS NULL;`);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS manual_audits (
        id SERIAL PRIMARY KEY,
        student_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
        task_title VARCHAR(255) NOT NULL,
        task_platform VARCHAR(50) NOT NULL,
        task_url TEXT NOT NULL,
        engagement_type VARCHAR(50) NOT NULL,
        student_platform_identifier VARCHAR(255),
        status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
        is_selected_for_audit BOOLEAN DEFAULT FALSE,
        submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        reviewed_at TIMESTAMP,
        reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        rejection_reason VARCHAR(100),
        admin_notes TEXT,
        CONSTRAINT unique_manual_audit UNIQUE (student_id, task_id, engagement_type)
      );
      
      -- Auto-migrate existing manual_audits if columns missing
      ALTER TABLE manual_audits ADD COLUMN IF NOT EXISTS student_platform_identifier VARCHAR(255);
      
      ALTER TABLE manual_audits DROP CONSTRAINT IF EXISTS check_manual_audit_status;
      ALTER TABLE manual_audits ADD CONSTRAINT check_manual_audit_status CHECK (status IN ('PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED'));
      
      ALTER TABLE manual_audits DROP CONSTRAINT IF EXISTS check_rejection_reason;
      ALTER TABLE manual_audits ADD CONSTRAINT check_rejection_reason CHECK (rejection_reason IN ('Like not found', 'Engagement not visible', 'Wrong account', 'Account not accessible', 'Task expired', 'Already reviewed', 'Other'));
      CREATE INDEX IF NOT EXISTS idx_manual_audits_student ON manual_audits(student_id);
      CREATE INDEX IF NOT EXISTS idx_manual_audits_task ON manual_audits(task_id);
      CREATE INDEX IF NOT EXISTS idx_manual_audits_status ON manual_audits(status);
      CREATE INDEX IF NOT EXISTS idx_manual_audits_submitted ON manual_audits(submitted_at);
      CREATE INDEX IF NOT EXISTS idx_manual_audits_platform ON manual_audits(task_platform);

      CREATE TABLE IF NOT EXISTS manual_audit_history (
        id SERIAL PRIMARY KEY,
        audit_id INTEGER REFERENCES manual_audits(id) ON DELETE CASCADE,
        previous_status VARCHAR(50),
        new_status VARCHAR(50) NOT NULL,
        reviewer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        reason VARCHAR(100),
        notes TEXT
      );
    `);
    console.log('Database constraints verified.');
  } catch (error) {
    console.error('Error during database startup initialization check:', error);
  }
}

checkAndInitializeDatabase().then(() => {
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
});
