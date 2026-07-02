-- EngageHub Database Schema

-- Drop tables if they exist (for easy re-initialization)
DROP TABLE IF EXISTS manual_audit_history CASCADE;
DROP TABLE IF EXISTS manual_audits CASCADE;
DROP TABLE IF EXISTS task_activity CASCADE;
DROP TABLE IF EXISTS tasks CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- Users Table
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL CHECK (role IN ('Admin', 'Student')),
  points INTEGER DEFAULT 0,
  instagram_username VARCHAR(255) DEFAULT NULL,
  youtube_handle VARCHAR(255) DEFAULT NULL,
  linkedin_profile VARCHAR(255) DEFAULT NULL,
  facebook_profile VARCHAR(255) DEFAULT NULL,
  facebook_display_name VARCHAR(255) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tasks Table
CREATE TABLE tasks (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  platform VARCHAR(50) NOT NULL CHECK (platform IN ('Instagram', 'YouTube', 'LinkedIn', 'Facebook')),
  social_link TEXT NOT NULL,
  duration_days INTEGER NOT NULL DEFAULT 7,
  expiry_date TIMESTAMP NOT NULL,
  verification_method VARCHAR(50) DEFAULT 'AUTOMATIC' CHECK (verification_method IN ('AUTOMATIC', 'MANUAL')),
  engagement_type VARCHAR(50) DEFAULT 'COMMENT' CHECK (engagement_type IN ('LIKE', 'COMMENT', 'REACTION', 'SAVE', 'SHARE', 'FOLLOW')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Task Activity Table
CREATE TABLE task_activity (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  status VARCHAR(50) NOT NULL CHECK (status IN ('PENDING', 'OPENED', 'COMPLETED', 'EXPIRED')),
  opened_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL,
  time_spent INTEGER DEFAULT 0,
  comment_status VARCHAR(50) NOT NULL DEFAULT 'Not Attempted' CHECK (comment_status IN ('Not Checked', 'Comment Verified', 'Comment Not Found', 'YouTube Account Not Available', 'Verification Error', 'Not Attempted', 'Comment Detected', 'Comment Not Verified', 'Platform Not Available', 'Invalid URL', 'Video ID Extraction Failed', 'Video Not Found', 'Handle Mismatch', 'Verification Successful')),
  comment_verified_at TIMESTAMP DEFAULT NULL,
  comment_points_awarded INTEGER DEFAULT 0,
  CONSTRAINT unique_user_task UNIQUE (user_id, task_id)
);

-- Verification Audit Logs Table
CREATE TABLE verification_audit_logs (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  student_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  student_name VARCHAR(255),
  youtube_handle VARCHAR(255),
  platform VARCHAR(50),
  video_id VARCHAR(50),
  source VARCHAR(50),
  comments_found INTEGER,
  match_found BOOLEAN,
  status VARCHAR(255),
  reason TEXT
);

-- YouTube API Usage Tracking Table
CREATE TABLE IF NOT EXISTS youtube_api_usage (
  id SERIAL PRIMARY KEY,
  request_type VARCHAR(255) NOT NULL,
  quota_cost INTEGER NOT NULL,
  status VARCHAR(50) NOT NULL,
  response_code INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Facebook API Usage Tracking Table
CREATE TABLE IF NOT EXISTS facebook_api_usage (
  id SERIAL PRIMARY KEY,
  request_type VARCHAR(255) NOT NULL,
  quota_cost INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(50) NOT NULL,
  response_code INTEGER,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Manual Audits Table
CREATE TABLE IF NOT EXISTS manual_audits (
  id SERIAL PRIMARY KEY,
  student_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  task_title VARCHAR(255) NOT NULL,
  task_platform VARCHAR(50) NOT NULL CHECK (task_platform IN ('Facebook', 'Instagram', 'YouTube', 'LinkedIn')),
  task_url TEXT NOT NULL,
  engagement_type VARCHAR(50) NOT NULL CHECK (engagement_type IN ('LIKE', 'COMMENT', 'REACTION', 'SAVE', 'SHARE', 'FOLLOW')),
  student_platform_identifier VARCHAR(255),
  status VARCHAR(50) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED')),
  is_selected_for_audit BOOLEAN DEFAULT FALSE,
  submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TIMESTAMP,
  reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  rejection_reason VARCHAR(100) CHECK (rejection_reason IN ('Like not found', 'Engagement not visible', 'Wrong account', 'Account not accessible', 'Task expired', 'Already reviewed', 'Other')),
  admin_notes TEXT,
  CONSTRAINT unique_manual_audit UNIQUE (student_id, task_id, engagement_type)
);

CREATE INDEX IF NOT EXISTS idx_manual_audits_student ON manual_audits(student_id);
CREATE INDEX IF NOT EXISTS idx_manual_audits_task ON manual_audits(task_id);
CREATE INDEX IF NOT EXISTS idx_manual_audits_status ON manual_audits(status);
CREATE INDEX IF NOT EXISTS idx_manual_audits_submitted ON manual_audits(submitted_at);
CREATE INDEX IF NOT EXISTS idx_manual_audits_platform ON manual_audits(task_platform);

-- Manual Audit History Table
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
