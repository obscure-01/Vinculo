-- EngageHub Database Schema

-- Users Table
CREATE TABLE IF NOT EXISTS users (
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
CREATE TABLE IF NOT EXISTS tasks (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  platform VARCHAR(50) NOT NULL CHECK (platform IN ('Instagram', 'YouTube', 'LinkedIn', 'Facebook')),
  social_link TEXT NOT NULL,
  points INTEGER NOT NULL DEFAULT 10 CONSTRAINT tasks_points_range_check CHECK (points BETWEEN 0 AND 10000),
  duration_days INTEGER NOT NULL DEFAULT 7,
  expiry_date TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Task Activity Table
CREATE TABLE IF NOT EXISTS task_activity (
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
CREATE TABLE IF NOT EXISTS verification_audit_logs (
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

-- Keep the public schema inaccessible to Supabase client roles.
-- Vinculo accesses PostgreSQL through its server-side database connection.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE youtube_api_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE facebook_api_usage ENABLE ROW LEVEL SECURITY;
