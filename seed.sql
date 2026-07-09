-- EngageHub Database Seed Data

-- Insert Admin Account
INSERT INTO users (name, email, password_hash, role, points) VALUES
('Admin User', 'admin@engagehub.edu', '$2a$10$prPT1DjE5qfyTKPnD83dheZMgUQR1NzCEmetrIvIADUyN0Q9pTQDW', 'Admin', 0)
ON CONFLICT (email) DO NOTHING;

-- Insert Student Accounts with Social Profiles
INSERT INTO users (name, email, password_hash, role, points, instagram_username, youtube_handle, linkedin_profile, facebook_profile) VALUES
('Alex Mercer', 'alex@engagehub.edu', '$2a$10$1qKdLuqDaIuyJ4titE3tYOoJtQEK/QrMnJ9miFBL3cOzksjk5p47W', 'Student', 120, 'alex_mercer', '@alexmercer', NULL, NULL),
('Aman Sharma', 'aman@engagehub.edu', '$2a$10$1qKdLuqDaIuyJ4titE3tYOoJtQEK/QrMnJ9miFBL3cOzksjk5p47W', 'Student', 210, 'aman_sharma', NULL, NULL, NULL),
('Priya Verma', 'priya@engagehub.edu', '$2a$10$1qKdLuqDaIuyJ4titE3tYOoJtQEK/QrMnJ9miFBL3cOzksjk5p47W', 'Student', 180, NULL, '@priyaverma', NULL, NULL),
('Rahul Singh', 'rahul@engagehub.edu', '$2a$10$1qKdLuqDaIuyJ4titE3tYOoJtQEK/QrMnJ9miFBL3cOzksjk5p47W', 'Student', 170, NULL, NULL, NULL, NULL),
('Sneha Reddy', 'sneha@engagehub.edu', '$2a$10$1qKdLuqDaIuyJ4titE3tYOoJtQEK/QrMnJ9miFBL3cOzksjk5p47W', 'Student', 150, NULL, NULL, NULL, NULL),
('Ram Sharma', 'ram@engagehub.edu', '$2a$10$1qKdLuqDaIuyJ4titE3tYOoJtQEK/QrMnJ9miFBL3cOzksjk5p47W', 'Student', 15, 'ram_sharma', NULL, NULL, NULL)
ON CONFLICT (email) DO NOTHING;

-- Insert Sample Tasks (Without engagement-specific columns)
INSERT INTO tasks (title, platform, social_link, duration_days, created_at, expiry_date) VALUES
('AI Workshop Reel', 'Instagram', 'https://www.instagram.com/reel/C7zX9JpS1A2/', 2, CURRENT_TIMESTAMP - INTERVAL '1 day', CURRENT_TIMESTAMP + INTERVAL '1 day'),
('Tech Fest Highlights Reel', 'Instagram', 'https://www.instagram.com/reel/C8aY0KqT2B3/', 7, CURRENT_TIMESTAMP - INTERVAL '10 days', CURRENT_TIMESTAMP - INTERVAL '3 days'),
('Placement Preparation Video', 'YouTube', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 5, CURRENT_TIMESTAMP - INTERVAL '6 days', CURRENT_TIMESTAMP - INTERVAL '1 day'),
('Innovation Showcase Video', 'YouTube', 'https://www.youtube.com/watch?v=3JZ_D3Kz0OA', 14, CURRENT_TIMESTAMP - INTERVAL '2 days', CURRENT_TIMESTAMP + INTERVAL '12 days'),
('Career Fair Announcement', 'LinkedIn', 'https://www.linkedin.com/posts/example-career-fair', 14, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '14 days'),
('College Hackathon Promo', 'Facebook', 'https://www.facebook.com/example-college-hackathon', 30, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '30 days');

-- Insert Task Engagements (Dynamic configuration for tasks)
-- For AI Workshop Reel
INSERT INTO task_engagements (task_id, engagement_type, verification_type, is_required, is_enabled, points) VALUES
((SELECT id FROM tasks WHERE title = 'AI Workshop Reel'), 'VISIT', 'AUTOMATIC', TRUE, TRUE, 10),
((SELECT id FROM tasks WHERE title = 'AI Workshop Reel'), 'LIKE', 'MANUAL', FALSE, TRUE, 5),
((SELECT id FROM tasks WHERE title = 'AI Workshop Reel'), 'COMMENT', 'AUTOMATIC', TRUE, TRUE, 15);

-- For Tech Fest Highlights Reel
INSERT INTO task_engagements (task_id, engagement_type, verification_type, is_required, is_enabled, points) VALUES
((SELECT id FROM tasks WHERE title = 'Tech Fest Highlights Reel'), 'VISIT', 'AUTOMATIC', TRUE, TRUE, 10),
((SELECT id FROM tasks WHERE title = 'Tech Fest Highlights Reel'), 'LIKE', 'MANUAL', TRUE, TRUE, 5);

-- For Placement Preparation Video
INSERT INTO task_engagements (task_id, engagement_type, verification_type, is_required, is_enabled, points) VALUES
((SELECT id FROM tasks WHERE title = 'Placement Preparation Video'), 'VISIT', 'AUTOMATIC', TRUE, TRUE, 10),
((SELECT id FROM tasks WHERE title = 'Placement Preparation Video'), 'COMMENT', 'AUTOMATIC', TRUE, TRUE, 20);

-- Insert Identity Snapshots (For students making manual declarations)
INSERT INTO identity_snapshots (student_id, platform, platform_identifier) VALUES
((SELECT id FROM users WHERE email = 'ram@engagehub.edu'), 'Instagram', 'ram_sharma');

-- Insert Student Activities (Granular progress for specific engagements)

-- Ram Sharma: Completed Visit and Comment, Declared Like
INSERT INTO student_activities (user_id, task_engagement_id, status, created_at, completed_at) VALUES
((SELECT id FROM users WHERE email = 'ram@engagehub.edu'), (SELECT id FROM task_engagements WHERE task_id = (SELECT id FROM tasks WHERE title = 'AI Workshop Reel') AND engagement_type = 'VISIT'), 'Completed', CURRENT_TIMESTAMP - INTERVAL '1 day', CURRENT_TIMESTAMP - INTERVAL '1 day' + INTERVAL '45 seconds'),
((SELECT id FROM users WHERE email = 'ram@engagehub.edu'), (SELECT id FROM task_engagements WHERE task_id = (SELECT id FROM tasks WHERE title = 'AI Workshop Reel') AND engagement_type = 'COMMENT'), 'Verified', CURRENT_TIMESTAMP - INTERVAL '1 day', CURRENT_TIMESTAMP - INTERVAL '1 day' + INTERVAL '45 seconds'),
((SELECT id FROM users WHERE email = 'ram@engagehub.edu'), (SELECT id FROM task_engagements WHERE task_id = (SELECT id FROM tasks WHERE title = 'AI Workshop Reel') AND engagement_type = 'LIKE'), 'Pending Review', CURRENT_TIMESTAMP - INTERVAL '1 day', NULL);

-- Alex Mercer: Completed Visit and Like (Approved)
INSERT INTO student_activities (user_id, task_engagement_id, status, created_at, completed_at) VALUES
((SELECT id FROM users WHERE email = 'alex@engagehub.edu'), (SELECT id FROM task_engagements WHERE task_id = (SELECT id FROM tasks WHERE title = 'Tech Fest Highlights Reel') AND engagement_type = 'VISIT'), 'Completed', CURRENT_TIMESTAMP - INTERVAL '9 days', CURRENT_TIMESTAMP - INTERVAL '9 days' + INTERVAL '45 seconds'),
((SELECT id FROM users WHERE email = 'alex@engagehub.edu'), (SELECT id FROM task_engagements WHERE task_id = (SELECT id FROM tasks WHERE title = 'Tech Fest Highlights Reel') AND engagement_type = 'LIKE'), 'Approved', CURRENT_TIMESTAMP - INTERVAL '9 days', CURRENT_TIMESTAMP - INTERVAL '8 days');

-- Insert Manual Audits (Tied to student activities and identity snapshots)
INSERT INTO manual_audits (student_activity_id, identity_snapshot_id, status, submitted_at, reviewed_at) VALUES
((SELECT id FROM student_activities WHERE status = 'Pending Review' LIMIT 1), (SELECT id FROM identity_snapshots LIMIT 1), 'PENDING', CURRENT_TIMESTAMP - INTERVAL '1 day', NULL);
