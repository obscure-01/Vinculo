-- EngageHub Database Schema

-- Drop tables if they exist (for easy re-initialization)
DROP TABLE IF EXISTS review_logs CASCADE;
DROP TABLE IF EXISTS manual_audit_history CASCADE;
DROP TABLE IF EXISTS manual_audits CASCADE;
DROP TABLE IF EXISTS identity_snapshots CASCADE;
DROP TABLE IF EXISTS student_activities CASCADE;
DROP TABLE IF EXISTS task_engagements CASCADE;
DROP TABLE IF EXISTS tasks CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS verification_audit_logs CASCADE;
DROP TABLE IF EXISTS youtube_api_usage CASCADE;
DROP TABLE IF EXISTS facebook_api_usage CASCADE;

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

-- Tasks Table (Task Content)
CREATE TABLE tasks (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  platform VARCHAR(50) NOT NULL CHECK (platform IN ('Instagram', 'YouTube', 'LinkedIn', 'Facebook')),
  social_link TEXT NOT NULL,
  duration_days INTEGER NOT NULL DEFAULT 7,
  expiry_date TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Task Engagements Table (Engagement Configuration)
CREATE TABLE task_engagements (
  id SERIAL PRIMARY KEY,
  task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  engagement_type VARCHAR(50) NOT NULL CHECK (engagement_type IN ('VISIT', 'LIKE', 'COMMENT', 'REACTION', 'SAVE', 'SHARE', 'FOLLOW')),
  verification_type VARCHAR(50) NOT NULL DEFAULT 'AUTOMATIC' CHECK (verification_type IN ('AUTOMATIC', 'MANUAL')),
  is_required BOOLEAN NOT NULL DEFAULT TRUE,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  points INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT unique_task_engagement UNIQUE (task_id, engagement_type)
);

CREATE INDEX idx_task_engagements_task ON task_engagements(task_id);

-- Identity Snapshots Table (Immutable Snapshot)
CREATE TABLE identity_snapshots (
  id SERIAL PRIMARY KEY,
  student_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  platform VARCHAR(50) NOT NULL,
  platform_identifier VARCHAR(255) NOT NULL,
  captured_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_identity_snapshots_student ON identity_snapshots(student_id);

-- Student Activities Table (Student Progress for ONE Engagement)
CREATE TABLE student_activities (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  task_engagement_id INTEGER REFERENCES task_engagements(id) ON DELETE CASCADE,
  status VARCHAR(50) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  CONSTRAINT unique_student_activity UNIQUE (user_id, task_engagement_id)
);

CREATE INDEX idx_student_activities_user ON student_activities(user_id);

-- Manual Audits Table (Verification Workflow)
CREATE TABLE manual_audits (
  id SERIAL PRIMARY KEY,
  student_activity_id INTEGER REFERENCES student_activities(id) ON DELETE CASCADE,
  identity_snapshot_id INTEGER REFERENCES identity_snapshots(id) ON DELETE RESTRICT,
  status VARCHAR(50) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED')),
  is_selected_for_audit BOOLEAN DEFAULT FALSE,
  submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TIMESTAMP,
  CONSTRAINT unique_manual_audit_activity UNIQUE (student_activity_id)
);

CREATE INDEX idx_manual_audits_activity ON manual_audits(student_activity_id);
CREATE INDEX idx_manual_audits_status ON manual_audits(status);
CREATE INDEX idx_manual_audits_submitted ON manual_audits(submitted_at);

-- Review Logs Table (Immutable Review Metadata)
CREATE TABLE review_logs (
  id SERIAL PRIMARY KEY,
  manual_audit_id INTEGER REFERENCES manual_audits(id) ON DELETE CASCADE,
  reviewer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  outcome VARCHAR(50) NOT NULL CHECK (outcome IN ('APPROVED', 'REJECTED')),
  rejection_reason VARCHAR(100) CHECK (rejection_reason IN ('Registered account could not be verified', 'Unable to confirm Like engagement', 'Other')),
  generated_note TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT unique_review_log UNIQUE (manual_audit_id)
);

-- Manual Audit History Table
CREATE TABLE manual_audit_history (
  id SERIAL PRIMARY KEY,
  audit_id INTEGER REFERENCES manual_audits(id) ON DELETE CASCADE,
  previous_status VARCHAR(50),
  new_status VARCHAR(50) NOT NULL,
  reviewer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  reason VARCHAR(100),
  notes TEXT
);

-- Verification Audit Logs Table (Existing Auto Verification)
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

-- YouTube API Usage Tracking Table (Existing Auto Verification)
CREATE TABLE IF NOT EXISTS youtube_api_usage (
  id SERIAL PRIMARY KEY,
  request_type VARCHAR(255) NOT NULL,
  quota_cost INTEGER NOT NULL,
  status VARCHAR(50) NOT NULL,
  response_code INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Facebook API Usage Tracking Table (Existing Auto Verification)
CREATE TABLE IF NOT EXISTS facebook_api_usage (
  id SERIAL PRIMARY KEY,
  request_type VARCHAR(255) NOT NULL,
  quota_cost INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(50) NOT NULL,
  response_code INTEGER,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
