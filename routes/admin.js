const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken, requireRole } = require('../express-middleware');

// Protect all routes with JWT and check for 'Admin' role
router.use(authenticateToken, requireRole('Admin'));

// 1. Dashboard Overview
router.get('/overview', async (req, res) => {
  try {
    const statsQuery = `
      SELECT 
        (SELECT COUNT(*)::int FROM users WHERE role = 'Student') as total_students,
        (SELECT COUNT(*)::int FROM tasks WHERE expiry_date >= CURRENT_TIMESTAMP) as total_tasks,
        (SELECT COUNT(*)::int FROM task_activity ta JOIN tasks t ON ta.task_id = t.id WHERE ta.status = 'COMPLETED' AND t.expiry_date >= CURRENT_TIMESTAMP) as completed_tasks,
        (
          SELECT COUNT(*)::int FROM users u 
          WHERE u.role = 'Student' 
          AND EXISTS (
            SELECT 1 FROM tasks t
            WHERE t.expiry_date >= CURRENT_TIMESTAMP
              AND NOT EXISTS (
                SELECT 1 FROM task_activity ta 
                WHERE ta.user_id = u.id AND ta.task_id = t.id AND ta.status = 'COMPLETED'
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
  const { title, platform, socialLink, durationDays } = req.body;

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

  try {
    const insertQuery = `
      INSERT INTO tasks (title, platform, social_link, duration_days, expiry_date)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;
    const result = await db.query(insertQuery, [title.trim(), normalizedPlatform, socialLink.trim(), finalDurationDays, expiryDate]);
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
        (SELECT COUNT(*)::int FROM task_activity ta WHERE ta.task_id = t.id AND ta.status = 'COMPLETED') as completed_count
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
      SELECT 
        (SELECT COUNT(*)::int FROM users WHERE role = 'Student') as total_students,
        (SELECT COUNT(*)::int FROM tasks WHERE expiry_date >= CURRENT_TIMESTAMP) as total_tasks,
        (SELECT COUNT(*)::int FROM task_activity ta JOIN tasks t ON ta.task_id = t.id WHERE ta.status = 'COMPLETED' AND t.expiry_date >= CURRENT_TIMESTAMP) as completed_tasks
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
        (SELECT COUNT(*)::int FROM task_activity ta WHERE ta.user_id = u.id AND ta.status = 'COMPLETED') as completed_count,
        COALESCE((
          SELECT COUNT(*)::int FROM tasks t
          LEFT JOIN task_activity ta ON ta.task_id = t.id AND ta.user_id = u.id AND ta.status = 'COMPLETED'
          WHERE t.expiry_date >= CURRENT_TIMESTAMP AND ta.id IS NULL
        ), 0) as pending_count
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
        (SELECT COUNT(*)::int FROM task_activity ta WHERE ta.task_id = t.id AND ta.status = 'COMPLETED') as completed_count,
        (SELECT COUNT(*)::int FROM task_activity ta WHERE ta.task_id = t.id AND ta.status = 'OPENED') as opened_count,
        ((SELECT COUNT(*) FROM users WHERE role = 'Student') - (SELECT COUNT(*)::int FROM task_activity ta WHERE ta.task_id = t.id AND ta.status = 'COMPLETED')) as pending_count
      FROM tasks t
      ORDER BY t.created_at DESC
    `;
    const tasksResult = await db.query(tasksQuery);

    // 4. Total Verified Comments
    const totalVerifiedResult = await db.query(
      "SELECT COUNT(*)::int FROM task_activity WHERE comment_status IN ('Comment Detected', 'Comment Verified', 'Verification Successful')"
    );
    const totalVerifiedComments = totalVerifiedResult.rows[0].count;

    // 4b. YouTube Verified Comments
    const ytVerifiedResult = await db.query(`
      SELECT COUNT(*)::int FROM task_activity ta 
      JOIN tasks t ON ta.task_id = t.id 
      WHERE t.platform = 'YouTube' AND ta.comment_status IN ('Comment Verified', 'Comment Detected', 'Verification Successful')
    `);
    const verifiedYouTubeComments = ytVerifiedResult.rows[0].count;

    // 4c. Total Comment Points Awarded
    const totalPointsResult = await db.query(
      "SELECT COALESCE(SUM(comment_points_awarded), 0)::int FROM task_activity"
    );
    const totalCommentPointsAwarded = totalPointsResult.rows[0].coalesce;

    // 4d. Students with Verified Comments
    const studentsWithCommentsResult = await db.query(
      "SELECT COUNT(DISTINCT user_id)::int FROM task_activity WHERE comment_status IN ('Comment Verified', 'Comment Detected', 'Verification Successful')"
    );
    const studentsWithVerifiedComments = studentsWithCommentsResult.rows[0].count;

    // 5. Comments Per Platform
    const platformBreakdownResult = await db.query(`
      SELECT t.platform, COUNT(ta.id)::int as count
      FROM tasks t
      JOIN task_activity ta ON ta.task_id = t.id
      WHERE ta.comment_status IN ('Comment Detected', 'Comment Verified', 'Verification Successful')
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
      SELECT u.id, u.name, u.email, COALESCE(SUM(CASE WHEN ta.comment_status IN ('Comment Detected', 'Comment Verified', 'Verification Successful') THEN 1 ELSE 0 END), 0)::int as verified_comments_count
      FROM users u
      LEFT JOIN task_activity ta ON ta.user_id = u.id
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
        (SELECT COUNT(*)::int FROM task_activity ta WHERE ta.user_id = u.id AND ta.status = 'COMPLETED') as completed_count,
        COALESCE((
          SELECT COUNT(*)::int FROM tasks t
          LEFT JOIN task_activity ta ON ta.task_id = t.id AND ta.user_id = u.id AND ta.status = 'COMPLETED'
          WHERE t.expiry_date >= CURRENT_TIMESTAMP AND ta.id IS NULL
        ), 0) as pending_count
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
          WHEN ta.status = 'COMPLETED' THEN 'COMPLETED'
          WHEN t.expiry_date < CURRENT_TIMESTAMP THEN 'EXPIRED'
          ELSE COALESCE(ta.status, 'PENDING')
        END as status,
        ta.opened_at,
        ta.completed_at,
        COALESCE(ta.comment_status, 'Not Attempted') as comment_status,
        ta.comment_verified_at,
        COALESCE(ta.comment_points_awarded, 0) as comment_points_awarded,
        (CASE WHEN ta.status = 'COMPLETED' THEN 10 ELSE 0 END + COALESCE(ta.comment_points_awarded, 0)) as points_earned
      FROM users u
      CROSS JOIN tasks t
      LEFT JOIN task_activity ta ON ta.user_id = u.id AND ta.task_id = t.id
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
          WHEN ta.status = 'COMPLETED' THEN 'COMPLETED'
          WHEN t.expiry_date < CURRENT_TIMESTAMP THEN 'EXPIRED'
          ELSE COALESCE(ta.status, 'PENDING')
        END as status,
        ta.opened_at,
        ta.completed_at
      FROM tasks t
      LEFT JOIN task_activity ta ON ta.task_id = t.id AND ta.user_id = $1
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

module.exports = router;
