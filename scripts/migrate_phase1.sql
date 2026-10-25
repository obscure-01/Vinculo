-- Vinculo phase 1 data migration
--
-- This migration is intentionally non-destructive. It keeps task_activity as
-- a read-only compatibility backup until the new model has been verified.
-- Run it against a restored backup or staging database before production.

BEGIN;

SELECT pg_advisory_xact_lock(74201901);

DO $$
DECLARE
  required_table TEXT;
BEGIN
  FOREACH required_table IN ARRAY ARRAY[
    'users',
    'tasks',
    'task_activity',
    'task_engagements',
    'student_activities',
    'manual_audits',
    'identity_snapshots',
    'review_logs',
    'manual_audit_history'
  ] LOOP
    IF to_regclass(format('public.%I', required_table)) IS NULL THEN
      RAISE EXCEPTION 'Migration prerequisite missing: public.%', required_table;
    END IF;
  END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS task_activity_legacy (
  LIKE task_activity INCLUDING ALL
);

INSERT INTO task_activity_legacy
SELECT ta.*
FROM task_activity ta
WHERE NOT EXISTS (
  SELECT 1
  FROM task_activity_legacy backup
  WHERE backup.id = ta.id
);

CREATE TABLE IF NOT EXISTS vinculo_migrations (
  version VARCHAR(100) PRIMARY KEY,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE task_activity_legacy ENABLE ROW LEVEL SECURITY;
ALTER TABLE vinculo_migrations ENABLE ROW LEVEL SECURITY;

-- Every task receives a visit engagement. Existing rows are preserved.
INSERT INTO task_engagements (
  task_id,
  engagement_type,
  verification_type,
  is_required,
  is_enabled,
  points
)
SELECT
  t.id,
  'VISIT',
  'AUTOMATIC',
  TRUE,
  TRUE,
  t.points
FROM tasks t
WHERE NOT EXISTS (
  SELECT 1
  FROM task_engagements te
  WHERE te.task_id = t.id
    AND te.engagement_type = 'VISIT'
);

-- A comment engagement can only be inferred when legacy activity contains
-- comment progress. Tasks without that evidence are left unchanged.
INSERT INTO task_engagements (
  task_id,
  engagement_type,
  verification_type,
  is_required,
  is_enabled,
  points
)
SELECT DISTINCT
  ta.task_id,
  'COMMENT',
  'AUTOMATIC',
  TRUE,
  TRUE,
  15
FROM task_activity_legacy ta
WHERE ta.comment_status IS NOT NULL
  AND ta.comment_status NOT IN ('Not Attempted', 'Not Checked')
  AND NOT EXISTS (
    SELECT 1
    FROM task_engagements te
    WHERE te.task_id = ta.task_id
      AND te.engagement_type = 'COMMENT'
  );

-- Migrate legacy visit activity without overwriting newer records.
INSERT INTO student_activities (
  user_id,
  task_engagement_id,
  status,
  created_at,
  completed_at
)
SELECT
  ta.user_id,
  te.id,
  CASE
    WHEN ta.status = 'COMPLETED' THEN 'Completed'
    WHEN ta.status = 'OPENED' THEN 'Started'
    ELSE 'Pending'
  END,
  COALESCE(ta.opened_at, CURRENT_TIMESTAMP),
  ta.completed_at
FROM task_activity_legacy ta
JOIN task_engagements te
  ON te.task_id = ta.task_id
 AND te.engagement_type = 'VISIT'
WHERE NOT EXISTS (
  SELECT 1
  FROM student_activities sa
  WHERE sa.user_id = ta.user_id
    AND sa.task_engagement_id = te.id
);

-- Migrate legacy comment progress where it exists.
INSERT INTO student_activities (
  user_id,
  task_engagement_id,
  status,
  created_at,
  completed_at
)
SELECT
  ta.user_id,
  te.id,
  CASE
    WHEN ta.comment_status IN ('Comment Verified', 'Verification Successful')
      THEN 'Verified'
    ELSE 'Pending'
  END,
  COALESCE(ta.opened_at, CURRENT_TIMESTAMP),
  ta.comment_verified_at
FROM task_activity_legacy ta
JOIN task_engagements te
  ON te.task_id = ta.task_id
 AND te.engagement_type = 'COMMENT'
WHERE ta.comment_status IS NOT NULL
  AND ta.comment_status NOT IN ('Not Attempted', 'Not Checked')
  AND NOT EXISTS (
    SELECT 1
    FROM student_activities sa
    WHERE sa.user_id = ta.user_id
      AND sa.task_engagement_id = te.id
  );

DO $$
DECLARE
  source_count INTEGER;
  migrated_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO source_count FROM task_activity_legacy;
  SELECT COUNT(*)
  INTO migrated_count
  FROM task_activity_legacy ta
  JOIN task_engagements te
    ON te.task_id = ta.task_id
   AND te.engagement_type = 'VISIT'
  JOIN student_activities sa
    ON sa.user_id = ta.user_id
   AND sa.task_engagement_id = te.id;

  IF migrated_count < source_count THEN
    RAISE EXCEPTION
      'Migration validation failed: % legacy activities, but only % visit activities migrated',
      source_count,
      migrated_count;
  END IF;
END $$;

INSERT INTO vinculo_migrations (version)
VALUES ('phase1-nondestructive-engagements')
ON CONFLICT (version) DO NOTHING;

COMMIT;
