const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken, requireRole } = require('../middleware');
const manualAuditService = require('../services/manualAuditService');
const auditAnalyticsService = require('../services/auditAnalyticsService');
// Protect all routes with JWT and check for 'Admin' role
router.use(authenticateToken, requireRole('Admin'));

// 1. Dashboard Overview
router.get('/overview', async (req, res) => {
  try {
    const statsQuery = `
      WITH TaskCompletion AS (
        SELECT u.id AS user_id, t.id AS task_id
        FROM users u
        CROSS JOIN tasks t
        WHERE u.role = 'Student' 
          AND t.expiry_date >= CURRENT_TIMESTAMP
          AND NOT EXISTS (
            SELECT 1 FROM task_engagements te
            WHERE te.task_id = t.id AND te.is_required = TRUE
            AND NOT EXISTS (
              SELECT 1 FROM student_activities sa 
              WHERE sa.task_engagement_id = te.id AND sa.user_id = u.id 
              AND sa.status IN ('Completed', 'Verified', 'Approved')
            )
          )
      )
      SELECT 
        (SELECT COUNT(*)::int FROM users WHERE role = 'Student') as total_students,
        (SELECT COUNT(*)::int FROM tasks WHERE expiry_date >= CURRENT_TIMESTAMP) as total_tasks,
        (SELECT COUNT(*)::int FROM TaskCompletion) as completed_tasks,
        (
          SELECT COUNT(DISTINCT u.id)::int FROM users u 
          WHERE u.role = 'Student' 
          AND EXISTS (
            SELECT 1 FROM tasks t
            WHERE t.expiry_date >= CURRENT_TIMESTAMP
              AND NOT EXISTS (
                SELECT 1 FROM TaskCompletion tc WHERE tc.user_id = u.id AND tc.task_id = t.id
              )
          )
        ) as pending_students
    `;
    const statsResult = await db.query(statsQuery);
    const stats = statsResult.rows[0];

    const totalStudents = stats.total_students;
    const totalTasks = stats.total_tasks;
    const completedTasks = stats.completed_tasks;
    const pendingStudents = stats.pending_students;

    // Engagement Rate = (Completed Tasks / Total Assigned Tasks) * 100
    // Total Assigned Tasks = Total Students * Total Tasks (Active)
    const totalAssigned = totalStudents * totalTasks;
    const engagementRate = totalAssigned > 0 
      ? Math.round((completedTasks / totalAssigned) * 100) 
      : 0;

    res.json({
      totalStudents,
      totalTasks,
      engagementRate: `${engagementRate}%`,
      pendingStudents
    });

  } catch (error) {
    console.error('Error fetching admin dashboard overview:', error);
    res.status(500).json({ error: 'Database query failed' });
  }
});

// 2. Create Task
router.post('/tasks', async (req, res) => {
  const { title, platform, socialLink, durationDays, verificationMethod, engagementType } = req.body;

  if (!title || !platform || !socialLink) {
    return res.status(400).json({ error: 'Title, platform, and social media link are required.' });
  }

  // Restrict platform to Instagram, YouTube, LinkedIn, and Facebook
  const normalizedPlatform = platform.trim();
  const allowedPlatforms = ['Instagram', 'YouTube', 'LinkedIn', 'Facebook'];
  if (!allowedPlatforms.includes(normalizedPlatform)) {
    return res.status(400).json({ error: 'Invalid platform. Supported: Instagram, YouTube, LinkedIn, Facebook.' });
  }

  // Parse duration days
  const parsedDuration = parseInt(durationDays, 10);
  const finalDurationDays = isNaN(parsedDuration) || parsedDuration <= 0 ? 7 : parsedDuration;
  const expiryDate = new Date(Date.now() + finalDurationDays * 24 * 60 * 60 * 1000);

  // Validate verification method and engagement type
  const vMethod = verificationMethod === 'MANUAL' ? 'MANUAL' : 'AUTOMATIC';
  const validEngagements = ['LIKE', 'COMMENT', 'REACTION', 'SAVE', 'SHARE', 'FOLLOW'];
  const eType = validEngagements.includes(engagementType) ? engagementType : 'COMMENT';

  try {
    const insertQuery = `
      INSERT INTO tasks (title, platform, social_link, duration_days, expiry_date, verification_method, engagement_type)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;
    const result = await db.query(insertQuery, [title.trim(), normalizedPlatform, socialLink.trim(), finalDurationDays, expiryDate, vMethod, eType]);
    res.status(201).json({
      message: 'Task created successfully.',
      task: result.rows[0]
    });
  } catch (error) {
    console.error('Error creating task:', error);
    res.status(500).json({ error: 'Failed to create task.' });
  }
});

// 3. Manage Tasks - View tasks list and Delete task
router.get('/tasks', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        t.*,
        (SELECT COUNT(*)::int FROM users WHERE role = 'Student') as assigned_count,
        (
          SELECT COUNT(*)::int 
          FROM users u 
          WHERE u.role = 'Student' 
            AND NOT EXISTS (
              SELECT 1 FROM task_engagements te
              WHERE te.task_id = t.id AND te.is_required = TRUE
                AND NOT EXISTS (
                  SELECT 1 FROM student_activities sa
                  WHERE sa.task_engagement_id = te.id AND sa.user_id = u.id AND sa.status IN ('Completed', 'Verified', 'Approved')
                )
            )
        ) as completed_count
      FROM tasks t
      ORDER BY t.created_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching tasks:', error);
    res.status(500).json({ error: 'Failed to retrieve tasks.' });
  }
});

router.delete('/tasks/:id', async (req, res) => {
  const taskId = req.params.id;

  try {
    const result = await db.query('DELETE FROM tasks WHERE id = $1 RETURNING *', [taskId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found.' });
    }

    res.json({ message: 'Task deleted successfully.', deletedTask: result.rows[0] });
  } catch (error) {
    console.error('Error deleting task:', error);
    res.status(500).json({ error: 'Failed to delete task.' });
  }
});

// 4. Analytics Overview & Tables
router.get('/analytics', async (req, res) => {
  try {
    // 1. Cards overview stats (active tasks only)
    const statsQuery = `
      WITH TaskCompletion AS (
        SELECT u.id AS user_id, t.id AS task_id
        FROM users u
        CROSS JOIN tasks t
        WHERE u.role = 'Student' 
          AND t.expiry_date >= CURRENT_TIMESTAMP
          AND NOT EXISTS (
            SELECT 1 FROM task_engagements te
            WHERE te.task_id = t.id AND te.is_required = TRUE
            AND NOT EXISTS (
              SELECT 1 FROM student_activities sa 
              WHERE sa.task_engagement_id = te.id AND sa.user_id = u.id 
              AND sa.status IN ('Completed', 'Verified', 'Approved')
            )
          )
      )
      SELECT 
        (SELECT COUNT(*)::int FROM users WHERE role = 'Student') as total_students,
        (SELECT COUNT(*)::int FROM tasks WHERE expiry_date >= CURRENT_TIMESTAMP) as total_tasks,
        (SELECT COUNT(*)::int FROM TaskCompletion) as completed_tasks
    `;
    const statsResult = await db.query(statsQuery);
    const stats = statsResult.rows[0];

    const totalStudents = stats.total_students;
    const totalTasks = stats.total_tasks;
    const completedTasks = stats.completed_tasks;
    
    const totalAssigned = totalStudents * totalTasks;
    const pendingTasks = Math.max(0, totalAssigned - completedTasks);
    const engagementRate = totalAssigned > 0 
      ? Math.round((completedTasks / totalAssigned) * 100) 
      : 0;

    // 2. Student performance list (with active pending count)
    const studentsQuery = `
      SELECT 
        u.id, 
        u.name, 
        u.email, 
        u.points,
        (
          SELECT COUNT(*)::int 
          FROM tasks t
          WHERE NOT EXISTS (
            SELECT 1 FROM task_engagements te
            WHERE te.task_id = t.id AND te.is_required = TRUE
              AND NOT EXISTS (
                SELECT 1 FROM student_activities sa
                WHERE sa.task_engagement_id = te.id AND sa.user_id = u.id AND sa.status IN ('Completed', 'Verified', 'Approved')
              )
          )
        ) as completed_count,
        (
          SELECT COUNT(*)::int 
          FROM tasks t
          WHERE t.expiry_date >= CURRENT_TIMESTAMP
            AND EXISTS (
              SELECT 1 FROM task_engagements te
              WHERE te.task_id = t.id AND te.is_required = TRUE
                AND NOT EXISTS (
                  SELECT 1 FROM student_activities sa
                  WHERE sa.task_engagement_id = te.id AND sa.user_id = u.id AND sa.status IN ('Completed', 'Verified', 'Approved')
                )
            )
        ) as pending_count
      FROM users u
      WHERE u.role = 'Student'
      ORDER BY u.points DESC
    `;
    const studentsResult = await db.query(studentsQuery);

    // 3. Task breakdown statistics (with created_at, expiry_date)
    const tasksQuery = `
      SELECT 
        t.id, 
        t.title, 
        t.platform, 
        t.social_link, 
        t.created_at,
        t.expiry_date,
        (
          SELECT COUNT(*)::int 
          FROM users u 
          WHERE u.role = 'Student' 
            AND NOT EXISTS (
              SELECT 1 FROM task_engagements te
              WHERE te.task_id = t.id AND te.is_required = TRUE
                AND NOT EXISTS (
                  SELECT 1 FROM student_activities sa
                  WHERE sa.task_engagement_id = te.id AND sa.user_id = u.id AND sa.status IN ('Completed', 'Verified', 'Approved')
                )
            )
        ) as completed_count,
        (
          SELECT COUNT(DISTINCT sa.user_id)::int 
          FROM student_activities sa
          JOIN task_engagements te ON sa.task_engagement_id = te.id
          WHERE te.task_id = t.id
        ) as opened_count,
        (
          (SELECT COUNT(*) FROM users WHERE role = 'Student') - 
          (
            SELECT COUNT(*)::int 
            FROM users u 
            WHERE u.role = 'Student' 
              AND NOT EXISTS (
                SELECT 1 FROM task_engagements te
                WHERE te.task_id = t.id AND te.is_required = TRUE
                  AND NOT EXISTS (
                    SELECT 1 FROM student_activities sa
                    WHERE sa.task_engagement_id = te.id AND sa.user_id = u.id AND sa.status IN ('Completed', 'Verified', 'Approved')
                  )
              )
          )
        ) as pending_count
      FROM tasks t
      ORDER BY t.created_at DESC
    `;
    const tasksResult = await db.query(tasksQuery);

    // 4. Total Verified Comments
    const totalVerifiedResult = await db.query(
      "SELECT COUNT(*)::int FROM student_activities sa JOIN task_engagements te ON sa.task_engagement_id = te.id WHERE te.engagement_type = 'COMMENT' AND sa.status IN ('Verified', 'Approved')"
    );
    const totalVerifiedComments = totalVerifiedResult.rows[0].count;

    // 4b. YouTube Verified Comments
    const ytVerifiedResult = await db.query(`
      SELECT COUNT(*)::int FROM student_activities sa 
      JOIN task_engagements te ON sa.task_engagement_id = te.id
      JOIN tasks t ON te.task_id = t.id 
      WHERE t.platform = 'YouTube' AND te.engagement_type = 'COMMENT' AND sa.status IN ('Verified', 'Approved')
    `);
    const verifiedYouTubeComments = ytVerifiedResult.rows[0].count;

    // 4c. Total Comment Points Awarded
    const totalPointsResult = await db.query(
      "SELECT COALESCE(SUM(te.points), 0)::int FROM student_activities sa JOIN task_engagements te ON sa.task_engagement_id = te.id WHERE te.engagement_type = 'COMMENT' AND sa.status IN ('Verified', 'Approved')"
    );
    const totalCommentPointsAwarded = totalPointsResult.rows[0].coalesce;

    // 4d. Students with Verified Comments
    const studentsWithCommentsResult = await db.query(
      "SELECT COUNT(DISTINCT sa.user_id)::int FROM student_activities sa JOIN task_engagements te ON sa.task_engagement_id = te.id WHERE te.engagement_type = 'COMMENT' AND sa.status IN ('Verified', 'Approved')"
    );
    const studentsWithVerifiedComments = studentsWithCommentsResult.rows[0].count;

    // 5. Comments Per Platform
    const platformBreakdownResult = await db.query(`
      SELECT t.platform, COUNT(sa.id)::int as count
      FROM tasks t
      JOIN task_engagements te ON te.task_id = t.id
      JOIN student_activities sa ON sa.task_engagement_id = te.id
      WHERE te.engagement_type = 'COMMENT' AND sa.status IN ('Verified', 'Approved')
      GROUP BY t.platform
    `);
    
    const commentsPerPlatform = {
      Instagram: 0,
      YouTube: 0,
      LinkedIn: 0,
      Facebook: 0
    };
    platformBreakdownResult.rows.forEach(row => {
      if (row.platform in commentsPerPlatform) {
        commentsPerPlatform[row.platform] = row.count;
      }
    });

    // 6. Top Commenters
    const topCommentersResult = await db.query(`
      SELECT u.id, u.name, u.email, COALESCE(SUM(CASE WHEN sa.status IN ('Verified', 'Approved') THEN 1 ELSE 0 END), 0)::int as verified_comments_count
      FROM users u
      LEFT JOIN student_activities sa ON sa.user_id = u.id
      LEFT JOIN task_engagements te ON sa.task_engagement_id = te.id AND te.engagement_type = 'COMMENT'
      WHERE u.role = 'Student'
      GROUP BY u.id, u.name, u.email
      ORDER BY verified_comments_count DESC, u.name ASC
      LIMIT 5
    `);

    res.json({
      overview: {
        totalStudents,
        totalTasks,
        completedTasks,
        pendingTasks,
        engagementRate: `${engagementRate}%`,
        totalVerifiedComments,
        verifiedYouTubeComments,
        totalCommentPointsAwarded,
        studentsWithVerifiedComments
      },
      commentsPerPlatform,
      topCommenters: topCommentersResult.rows,
      students: studentsResult.rows,
      tasks: tasksResult.rows
    });

  } catch (error) {
    console.error('Error fetching analytics:', error);
    res.status(500).json({ error: 'Failed to retrieve analytics data.' });
  }
});

// 5. Leaderboard - Ranked by points
router.get('/leaderboard', async (req, res) => {
  try {
    const leaderboardQuery = `
      SELECT id, name, points,
        ROW_NUMBER() OVER (ORDER BY points DESC) as rank
      FROM users
      WHERE role = 'Student'
      ORDER BY points DESC
    `;
    const result = await db.query(leaderboardQuery);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    res.status(500).json({ error: 'Failed to fetch leaderboard rankings.' });
  }
});

// 6. List Registered Students
router.get('/students', async (req, res) => {
  try {
    const studentsQuery = `
      SELECT 
        u.id, 
        u.name, 
        u.email, 
        u.points,
        u.created_at,
        (
          SELECT COUNT(*)::int 
          FROM tasks t
          WHERE NOT EXISTS (
            SELECT 1 FROM task_engagements te
            WHERE te.task_id = t.id AND te.is_required = TRUE
              AND NOT EXISTS (
                SELECT 1 FROM student_activities sa
                WHERE sa.task_engagement_id = te.id AND sa.user_id = u.id AND sa.status IN ('Completed', 'Verified', 'Approved')
              )
          )
        ) as completed_count,
        (
          SELECT COUNT(*)::int 
          FROM tasks t
          WHERE t.expiry_date >= CURRENT_TIMESTAMP
            AND EXISTS (
              SELECT 1 FROM task_engagements te
              WHERE te.task_id = t.id AND te.is_required = TRUE
                AND NOT EXISTS (
                  SELECT 1 FROM student_activities sa
                  WHERE sa.task_engagement_id = te.id AND sa.user_id = u.id AND sa.status IN ('Completed', 'Verified', 'Approved')
                )
            )
        ) as pending_count
      FROM users u
      WHERE u.role = 'Student'
      ORDER BY u.name ASC
    `;
    const result = await db.query(studentsQuery);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching students list:', error);
    res.status(500).json({ error: 'Failed to retrieve students list.' });
  }
});

// 7. Delete Student Account (with admin safeguard)
router.delete('/students/:id', async (req, res) => {
  const studentId = req.params.id;

  try {
    const checkResult = await db.query('SELECT role FROM users WHERE id = $1', [studentId]);
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found.' });
    }
    if (checkResult.rows[0].role !== 'Student') {
      return res.status(403).json({ error: 'Forbidden: Admin accounts cannot be deleted.' });
    }

    const deleteResult = await db.query('DELETE FROM users WHERE id = $1 RETURNING *', [studentId]);
    
    res.json({
      message: 'Student deleted successfully.',
      deletedStudent: deleteResult.rows[0]
    });
  } catch (error) {
    console.error('Error deleting student:', error);
    res.status(500).json({ error: 'Failed to delete student. Database error.' });
  }
});

// 8. Get All Student-Task Tracking Data
router.get('/tracking', async (req, res) => {
  try {
    const trackingQuery = `
      SELECT 
        u.id as student_id,
        u.name as student_name,
        t.id as task_id,
        t.title as task_title,
        t.platform as platform,
        CASE 
          WHEN NOT EXISTS (
            SELECT 1 FROM task_engagements te
            WHERE te.task_id = t.id AND te.is_required = TRUE
            AND NOT EXISTS (
              SELECT 1 FROM student_activities sa
              WHERE sa.task_engagement_id = te.id AND sa.user_id = u.id AND sa.status IN ('Completed', 'Verified', 'Approved')
            )
          ) AND EXISTS (
            SELECT 1 FROM task_engagements te JOIN student_activities sa ON sa.task_engagement_id = te.id WHERE te.task_id = t.id AND sa.user_id = u.id
          ) THEN 'COMPLETED'
          WHEN t.expiry_date < CURRENT_TIMESTAMP THEN 'EXPIRED'
          WHEN EXISTS (
            SELECT 1 FROM task_engagements te JOIN student_activities sa ON sa.task_engagement_id = te.id WHERE te.task_id = t.id AND sa.user_id = u.id
          ) THEN 'OPENED'
          ELSE 'PENDING'
        END as status,
        (
          SELECT MIN(sa.created_at) FROM student_activities sa JOIN task_engagements te ON sa.task_engagement_id = te.id WHERE te.task_id = t.id AND sa.user_id = u.id
        ) as opened_at,
        (
          SELECT MAX(sa.completed_at) FROM student_activities sa JOIN task_engagements te ON sa.task_engagement_id = te.id WHERE te.task_id = t.id AND sa.user_id = u.id AND sa.status IN ('Completed', 'Verified', 'Approved')
        ) as completed_at,
        COALESCE((
          SELECT sa.status FROM student_activities sa JOIN task_engagements te ON sa.task_engagement_id = te.id WHERE te.task_id = t.id AND te.engagement_type = 'COMMENT' AND sa.user_id = u.id LIMIT 1
        ), 'Not Attempted') as comment_status,
        (
          SELECT sa.completed_at FROM student_activities sa JOIN task_engagements te ON sa.task_engagement_id = te.id WHERE te.task_id = t.id AND te.engagement_type = 'COMMENT' AND sa.user_id = u.id LIMIT 1
        ) as comment_verified_at,
        COALESCE((
          SELECT te.points FROM student_activities sa JOIN task_engagements te ON sa.task_engagement_id = te.id WHERE te.task_id = t.id AND te.engagement_type = 'COMMENT' AND sa.user_id = u.id AND sa.status IN ('Verified', 'Approved') LIMIT 1
        ), 0) as comment_points_awarded,
        (
          SELECT COALESCE(SUM(te.points), 0) FROM student_activities sa JOIN task_engagements te ON sa.task_engagement_id = te.id WHERE te.task_id = t.id AND sa.user_id = u.id AND sa.status IN ('Completed', 'Verified', 'Approved')
        ) as points_earned
      FROM users u
      CROSS JOIN tasks t
      WHERE u.role = 'Student'
      ORDER BY u.name ASC, t.created_at DESC
    `;
    const result = await db.query(trackingQuery);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching task tracking:', error);
    res.status(500).json({ error: 'Failed to retrieve tracking data.' });
  }
});

// 9. Get Specific Student's Progress Details
router.get('/students/:id/tasks', async (req, res) => {
  const studentId = req.params.id;

  try {
    // Verify the student exists and is a Student
    const userCheck = await db.query('SELECT name, role FROM users WHERE id = $1', [studentId]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found.' });
    }
    if (userCheck.rows[0].role !== 'Student') {
      return res.status(400).json({ error: 'User is not a student.' });
    }

    const progressQuery = `
      SELECT 
        t.id as task_id,
        t.title as task_title,
        t.platform as platform,
        CASE 
          WHEN NOT EXISTS (
            SELECT 1 FROM task_engagements te
            WHERE te.task_id = t.id AND te.is_required = TRUE
            AND NOT EXISTS (
              SELECT 1 FROM student_activities sa
              WHERE sa.task_engagement_id = te.id AND sa.user_id = $1 AND sa.status IN ('Completed', 'Verified', 'Approved')
            )
          ) AND EXISTS (
            SELECT 1 FROM task_engagements te JOIN student_activities sa ON sa.task_engagement_id = te.id WHERE te.task_id = t.id AND sa.user_id = $1
          ) THEN 'COMPLETED'
          WHEN t.expiry_date < CURRENT_TIMESTAMP THEN 'EXPIRED'
          WHEN EXISTS (
            SELECT 1 FROM task_engagements te JOIN student_activities sa ON sa.task_engagement_id = te.id WHERE te.task_id = t.id AND sa.user_id = $1
          ) THEN 'OPENED'
          ELSE 'PENDING'
        END as status,
        (
          SELECT MIN(sa.created_at) FROM student_activities sa JOIN task_engagements te ON sa.task_engagement_id = te.id WHERE te.task_id = t.id AND sa.user_id = $1
        ) as opened_at,
        (
          SELECT MAX(sa.completed_at) FROM student_activities sa JOIN task_engagements te ON sa.task_engagement_id = te.id WHERE te.task_id = t.id AND sa.user_id = $1 AND sa.status IN ('Completed', 'Verified', 'Approved')
        ) as completed_at
      FROM tasks t
      ORDER BY t.created_at DESC
    `;
    const result = await db.query(progressQuery, [studentId]);
    res.json({
      studentName: userCheck.rows[0].name,
      tasks: result.rows
    });
  } catch (error) {
    console.error('Error fetching student progress:', error);
    res.status(500).json({ error: 'Failed to retrieve student progress details.' });
  }
});
// 10. Admin Debug View - Get verification logs
router.get('/verification-logs', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM verification_audit_logs ORDER BY timestamp DESC LIMIT 5000');
    const logs = result.rows.map(row => ({
      timestamp: row.timestamp,
      taskId: row.task_id,
      studentId: row.student_id,
      studentName: row.student_name,
      storedHandle: row.youtube_handle,
      platform: row.platform,
      videoId: row.video_id,
      verificationSource: row.source,
      numComments: row.comments_found,
      matchResult: row.match_found,
      status: row.status,
      reason: row.reason
    }));
    res.json(logs);
  } catch (error) {
    console.error('Error fetching verification logs:', error);
    res.status(500).json({ error: 'Failed to retrieve verification logs.' });
  }
});

// 11. Admin Settings - YouTube API
router.get('/settings/youtube', (req, res) => {
  try {
    const status = global.youtubeApiStatus || {
      status: process.env.YOUTUBE_API_KEY ? 'Configured' : 'Missing API Key',
      lastAttempt: null,
      lastResponseStatus: null
    };
    res.json(status);
  } catch (error) {
    console.error('Error fetching YouTube API settings:', error);
    res.status(500).json({ error: 'Failed to retrieve settings.' });
  }
});

// 12. Admin Settings - Facebook API
router.get('/facebook-status', async (req, res) => {
  try {
    const usageResult = await db.query("SELECT COUNT(*) AS request_count FROM facebook_api_usage WHERE DATE(created_at) = CURRENT_DATE");
    const lastReqResult = await db.query("SELECT status, response_code, created_at, error_message FROM facebook_api_usage ORDER BY created_at DESC LIMIT 1");
    
    const requestCount = parseInt(usageResult.rows[0]?.request_count || 0, 10);
    const lastReq = lastReqResult.rows.length > 0 ? lastReqResult.rows[0] : null;

    res.json({
      envKeyPresent: !!process.env.FACEBOOK_PAGE_ACCESS_TOKEN,
      verificationMode: process.env.FACEBOOK_PAGE_ACCESS_TOKEN ? "REAL_API" : "MOCK",
      startupDetectedKey: global.facebookApiStatus?.status === 'Configured',
      usage: {
        requestsToday: requestCount
      },
      lastRequest: lastReq ? {
        status: lastReq.status,
        responseCode: lastReq.response_code,
        errorMessage: lastReq.error_message,
        timestamp: lastReq.created_at
      } : null
    });
  } catch (error) {
    console.error('Error fetching facebook status:', error);
    res.status(500).json({ error: 'Failed to retrieve facebook status.' });
  }
});

// --- MANUAL ENGAGEMENT AUDIT SYSTEM ---

// 13. Get Overview Stats
router.get('/manual-audits/overview', async (req, res) => {
  try {
    const stats = await manualAuditService.getOverviewStats();
    res.json(stats);
  } catch (error) {
    console.error('Error fetching manual audit overview:', error);
    res.status(500).json({ error: 'Failed to retrieve overview stats.' });
  }
});

// 14. Get Audit List (Paginated)
router.get('/manual-audits', async (req, res) => {
  const { limit = 20, offset = 0, status, is_selected_for_audit } = req.query;
  try {
    const result = await manualAuditService.getManualAudits(limit, offset, status, is_selected_for_audit);
    res.json(result);
  } catch (error) {
    console.error('Error fetching manual audits:', error);
    res.status(500).json({ error: 'Failed to fetch manual audits.' });
  }
});

// 15. Generate Random Audit Batch
router.post('/manual-audits/generate-batch', async (req, res) => {
  try {
    const percentage = global.MANUAL_AUDIT_PERCENTAGE || 25;
    const result = await manualAuditService.generateAuditBatch(percentage);
    res.json(result);
  } catch (error) {
    console.error('Error generating audit batch:', error);
    res.status(500).json({ error: 'Failed to generate audit batch.' });
  }
});

// 16. Batch Review (Approve/Reject)
router.post('/manual-audits/batch-review', async (req, res) => {
  const { auditIds, action, reason, notes } = req.body;
  
  if (!auditIds || !Array.isArray(auditIds) || auditIds.length === 0) {
    return res.status(400).json({ error: 'No audits selected.' });
  }
  if (!['approve', 'reject'].includes(action)) {
    return res.status(400).json({ error: 'Invalid action.' });
  }
  if (action === 'reject' && !reason) {
    return res.status(400).json({ error: 'Reason is mandatory for rejection.' });
  }
  if (action === 'reject' && reason === 'Other' && !notes) {
    return res.status(400).json({ error: 'Notes are mandatory when rejection reason is Other.' });
  }

  try {
    const result = await manualAuditService.batchReviewAudits(auditIds, action, reason, notes, req.user.id, req.user.name);
    res.json(result);
  } catch (error) {
    console.error('Unexpected error in batch review:', error.message);
    res.status(500).json({ error: 'An unexpected error occurred during batch review.', details: error.message });
  }
});

// 17. Audit Analytics - Queue
router.get('/manual-audits/analytics/queue', async (req, res) => {
  try {
    const result = await auditAnalyticsService.getQueueAnalytics();
    res.json(result);
  } catch (error) {
    console.error('Error fetching queue analytics:', error);
    const status = error.status || 500;
    res.status(status).json({ error: error.message || 'Failed to fetch queue analytics.' });
  }
});

// 18. Audit Analytics - Performance
router.get('/manual-audits/analytics/performance', async (req, res) => {
  try {
    const result = await auditAnalyticsService.getPerformanceAnalytics(req.query);
    res.json(result);
  } catch (error) {
    console.error('Error fetching performance analytics:', error);
    const status = error.status || 500;
    res.status(status).json({ error: error.message || 'Failed to fetch performance analytics.' });
  }
});

// 19. Review History
router.get('/manual-audits/history', async (req, res) => {
  try {
    const result = await auditAnalyticsService.getReviewHistory(req.query);
    res.json(result);
  } catch (error) {
    console.error('Error fetching review history:', error);
    const status = error.status || 500;
    res.status(status).json({ error: error.message || 'Failed to fetch review history.' });
  }
});

// 20. Review Log Explorer
router.get('/manual-audits/logs', async (req, res) => {
  try {
    const result = await auditAnalyticsService.getReviewLogs(req.query);
    res.json(result);
  } catch (error) {
    console.error('Error fetching review logs:', error);
    const status = error.status || 500;
    res.status(status).json({ error: error.message || 'Failed to fetch review logs.' });
  }
});

// 21. Student Verification Timeline
router.get('/manual-audits/:auditId/timeline', async (req, res) => {
  try {
    const result = await auditAnalyticsService.getAuditTimeline(req.params.auditId);
    res.json(result);
  } catch (error) {
    console.error('Error fetching audit timeline:', error);
    const status = error.status || 500;
    res.status(status).json({ error: error.message || 'Failed to fetch timeline.' });
  }
});

// 22. Get specific student's audit history
router.get('/manual-audits/student/:id', async (req, res) => {
  try {
    const result = await manualAuditService.getStudentAudits(req.params.id);
    res.json(result);
  } catch (error) {
    console.error('Error fetching student manual audits:', error);
    res.status(500).json({ error: 'Failed to retrieve student audits.' });
  }
});

module.exports = router;
