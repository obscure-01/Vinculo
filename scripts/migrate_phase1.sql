BEGIN;

-- 1. Create legacy backups
CREATE TABLE IF NOT EXISTS task_activity_legacy AS SELECT * FROM task_activity;
CREATE TABLE IF NOT EXISTS tasks_legacy AS SELECT * FROM tasks;
CREATE TABLE IF NOT EXISTS manual_audits_legacy AS SELECT * FROM manual_audits;
CREATE TABLE IF NOT EXISTS manual_audit_history_legacy AS SELECT * FROM manual_audit_history;

-- 2. Create new tables
CREATE TABLE IF NOT EXISTS task_engagements (
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

CREATE TABLE IF NOT EXISTS identity_snapshots (
  id SERIAL PRIMARY KEY,
  student_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  platform VARCHAR(50) NOT NULL,
  platform_identifier VARCHAR(255) NOT NULL,
  captured_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS student_activities (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  task_engagement_id INTEGER REFERENCES task_engagements(id) ON DELETE CASCADE,
  status VARCHAR(50) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  CONSTRAINT unique_student_activity UNIQUE (user_id, task_engagement_id)
);

CREATE TABLE IF NOT EXISTS review_logs (
  id SERIAL PRIMARY KEY,
  manual_audit_id INTEGER, -- FK added after manual_audits is recreated
  reviewer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  outcome VARCHAR(50) NOT NULL CHECK (outcome IN ('APPROVED', 'REJECTED')),
  rejection_reason VARCHAR(100) CHECK (rejection_reason IN ('Registered account could not be verified', 'Unable to confirm Like engagement', 'Other')),
  generated_note TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Data Transformation (Tasks)
-- Insert Visit engagement for all tasks
INSERT INTO task_engagements (task_id, engagement_type, verification_type, is_required, points)
SELECT id, 'VISIT', 'AUTOMATIC', TRUE, 10 FROM tasks_legacy;

-- Insert Comment engagement for tasks that had it
INSERT INTO task_engagements (task_id, engagement_type, verification_type, is_required, points)
SELECT id, 'COMMENT', 'AUTOMATIC', TRUE, 15 FROM tasks_legacy WHERE engagement_type = 'COMMENT';

-- Insert Like engagement for tasks that had it
INSERT INTO task_engagements (task_id, engagement_type, verification_type, is_required, points)
SELECT id, 'LIKE', 'MANUAL', FALSE, 5 FROM tasks_legacy WHERE engagement_type = 'LIKE';

-- 4. Data Transformation (Student Activities)
-- Insert Visit activities
INSERT INTO student_activities (user_id, task_engagement_id, status, created_at, completed_at)
SELECT 
  ta.user_id, 
  te.id, 
  CASE WHEN ta.status IN ('COMPLETED', 'OPENED') THEN 'Completed' ELSE 'Not Started' END,
  ta.opened_at,
  ta.opened_at + (ta.time_spent || ' seconds')::interval
FROM task_activity_legacy ta
JOIN task_engagements te ON te.task_id = ta.task_id AND te.engagement_type = 'VISIT';

-- Insert Comment activities
INSERT INTO student_activities (user_id, task_engagement_id, status, created_at, completed_at)
SELECT 
  ta.user_id, 
  te.id, 
  CASE WHEN ta.comment_status IN ('Comment Verified', 'Verification Successful') THEN 'Verified' ELSE 'Verifying' END,
  ta.opened_at,
  ta.comment_verified_at
FROM task_activity_legacy ta
JOIN task_engagements te ON te.task_id = ta.task_id AND te.engagement_type = 'COMMENT'
WHERE ta.comment_status NOT IN ('Not Attempted', 'Not Checked');

-- 5. Data Transformation (Manual Audits & Snapshots)
-- Create Identity Snapshots
INSERT INTO identity_snapshots (student_id, platform, platform_identifier, captured_at)
SELECT student_id, task_platform, student_platform_identifier, submitted_at
FROM manual_audits_legacy
WHERE student_platform_identifier IS NOT NULL;

-- 6. Schema Cleanup & Constraint Application
-- Drop deprecated columns from tasks
ALTER TABLE tasks DROP COLUMN IF EXISTS verification_method;
ALTER TABLE tasks DROP COLUMN IF EXISTS engagement_type;

-- Recreate manual audits table properly mapped
DROP TABLE manual_audits CASCADE;

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

-- Map old manual audits to new while preserving their original IDs so history remains linked
INSERT INTO manual_audits (id, student_activity_id, identity_snapshot_id, status, submitted_at, reviewed_at)
SELECT 
  ma.id,
  sa.id,
  (SELECT iso.id FROM identity_snapshots iso WHERE iso.student_id = ma.student_id AND iso.platform_identifier = ma.student_platform_identifier LIMIT 1),
  ma.status,
  ma.submitted_at,
  ma.reviewed_at
FROM manual_audits_legacy ma
JOIN task_engagements te ON te.task_id = ma.task_id AND te.engagement_type = ma.engagement_type
JOIN student_activities sa ON sa.task_engagement_id = te.id AND sa.user_id = ma.student_id;

-- Reset sequence for manual_audits since we manually inserted IDs
SELECT setval('manual_audits_id_seq', COALESCE((SELECT MAX(id) FROM manual_audits), 1));

-- Add FK for review_logs
ALTER TABLE review_logs ADD CONSTRAINT fk_manual_audit FOREIGN KEY (manual_audit_id) REFERENCES manual_audits(id) ON DELETE CASCADE;

-- Insert review logs from old admin notes
INSERT INTO review_logs (manual_audit_id, reviewer_id, outcome, rejection_reason, generated_note)
SELECT 
  (SELECT na.id FROM manual_audits na JOIN student_activities sa ON sa.id = na.student_activity_id WHERE sa.user_id = ma.student_id LIMIT 1),
  ma.reviewed_by,
  CASE WHEN ma.status = 'APPROVED' THEN 'APPROVED' ELSE 'REJECTED' END,
  ma.rejection_reason,
  ma.admin_notes
FROM manual_audits_legacy ma
WHERE ma.status IN ('APPROVED', 'REJECTED');

-- Recreate manual_audit_history to map to new audit IDs
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

INSERT INTO manual_audit_history (id, audit_id, previous_status, new_status, reviewer_id, changed_at, reason, notes)
SELECT id, audit_id, previous_status, new_status, reviewer_id, changed_at, reason, notes FROM manual_audit_history_legacy;

SELECT setval('manual_audit_history_id_seq', COALESCE((SELECT MAX(id) FROM manual_audit_history), 1));

-- Drop old task_activity
DROP TABLE task_activity CASCADE;

-- Validation check 
DO $$
BEGIN
  IF (SELECT COUNT(*) FROM student_activities) < (SELECT COUNT(*) FROM task_activity_legacy) THEN
    RAISE EXCEPTION 'Data migration failed: Fewer activities than expected. Rolling back.';
  END IF;
END $$;

COMMIT;
