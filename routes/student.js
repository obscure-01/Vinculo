const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken, requireRole } = require('../express-middleware');

// Protect all routes with JWT and check for 'Student' role
router.use(authenticateToken, requireRole('Student'));

// Rate Limiter for Verification
const rateLimitMap = new Map(); // key: `${userId}_${taskId}`, value: { count, resetTime }

function checkRateLimit(userId, taskId) {
  const key = `${userId}_${taskId}`;
  const now = Date.now();
  if (rateLimitMap.has(key)) {
    const data = rateLimitMap.get(key);
    if (now > data.resetTime) {
      rateLimitMap.set(key, { count: 1, resetTime: now + 5 * 60 * 1000 });
      return true;
    }
    if (data.count >= 3) {
      return false;
    }
    data.count++;
    return true;
  }
  rateLimitMap.set(key, { count: 1, resetTime: now + 5 * 60 * 1000 });
  return true;
}

// Facebook Post ID Extraction
function extractFacebookPostId(url) {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname;
    const searchParams = parsed.searchParams;

    if (pathname.includes('permalink.php') || pathname.includes('story.php')) {
      const storyFbid = searchParams.get('story_fbid');
      const pageId = searchParams.get('id');
      if (storyFbid && pageId) return `${pageId}_${storyFbid}`;
    }
    if (pathname.includes('photo')) {
      return searchParams.get('fbid');
    }
    if (pathname.includes('/watch')) {
      return searchParams.get('v');
    }
    const postsMatch = pathname.match(/\/([^/]+)\/posts\/([^/?]+)/);
    if (postsMatch) {
      if (postsMatch[2].startsWith('pfbid')) return postsMatch[2];
      if (/^\d+$/.test(postsMatch[1])) return `${postsMatch[1]}_${postsMatch[2]}`;
      return postsMatch[2];
    }
    const videosMatch = pathname.match(/\/([^/]+)\/videos\/(\d+)/);
    if (videosMatch) return videosMatch[2];
    
    return null;
  } catch (err) {
    return null;
  }
}

function matchFacebookName(storedName, commenterName) {
  if (!storedName || !commenterName) return false;
  const normalize = (s) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  return normalize(storedName) === normalize(commenterName);
}

// 1. Welcome Section & Overview Dashboard
router.get('/dashboard', async (req, res) => {
  const userId = req.user.id;

  try {
    // 1. Get student points
    const userResult = await db.query('SELECT name, points FROM users WHERE id = $1', [userId]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }
    const user = userResult.rows[0];

    // 2. Calculate rank from leaderboard position
    const rankQuery = `
      WITH ranked_students AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY points DESC) as rank
        FROM users
        WHERE role = 'Student'
      )
      SELECT rank FROM ranked_students WHERE id = $1
    `;
    const rankResult = await db.query(rankQuery, [userId]);
    const rank = rankResult.rows.length > 0 ? rankResult.rows[0].rank : '-';

    res.json({
      name: user.name,
      points: user.points,
      rank: `#${rank}`
    });

  } catch (error) {
    console.error('Error fetching student dashboard:', error);
    res.status(500).json({ error: 'Database query failed' });
  }
});

// 2. Pending Tasks List (status = PENDING or OPENED, but not COMPLETED)
router.get('/tasks', async (req, res) => {
  const userId = req.user.id;

  try {
    const tasksQuery = `
      SELECT 
        t.id, 
        t.title, 
        t.platform, 
        t.social_link, 
        t.expiry_date,
        COALESCE(ta.status, 'PENDING') as status,
        ta.opened_at
      FROM tasks t
      LEFT JOIN task_activity ta ON ta.task_id = t.id AND ta.user_id = $1
      WHERE (ta.status IS NULL OR ta.status != 'COMPLETED')
        AND t.expiry_date >= CURRENT_TIMESTAMP
      ORDER BY t.created_at DESC
    `;
    const result = await db.query(tasksQuery, [userId]);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching student tasks:', error);
    res.status(500).json({ error: 'Failed to retrieve tasks.' });
  }
});

// 2b. Completed Tasks List
router.get('/tasks/completed', async (req, res) => {
  const userId = req.user.id;

  try {
     const completedQuery = `
      SELECT 
        t.id, 
        t.title, 
        t.platform, 
        t.social_link, 
        ta.completed_at,
        ta.time_spent,
        ta.comment_status,
        ta.comment_points_awarded
      FROM tasks t
      JOIN task_activity ta ON ta.task_id = t.id AND ta.user_id = $1
      WHERE ta.status = 'COMPLETED'
      ORDER BY ta.completed_at DESC
    `;
    const result = await db.query(completedQuery, [userId]);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching student completed tasks:', error);
    res.status(500).json({ error: 'Failed to retrieve completed tasks.' });
  }
});

// 3. Open Task Logic
router.post('/tasks/:id/open', async (req, res) => {
  const userId = req.user.id;
  const taskId = req.params.id;

  try {
    // Check if task exists
    const taskCheck = await db.query('SELECT * FROM tasks WHERE id = $1', [taskId]);
    if (taskCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found.' });
    }

    // Check if task has expired
    if (new Date(taskCheck.rows[0].expiry_date) < new Date()) {
      return res.status(400).json({ error: 'This task has expired and cannot be opened.' });
    }

    // Upsert task activity as OPENED and reset opened_at to now
    const upsertQuery = `
      INSERT INTO task_activity (user_id, task_id, status, opened_at)
      VALUES ($1, $2, 'OPENED', CURRENT_TIMESTAMP)
      ON CONFLICT (user_id, task_id) 
      DO UPDATE SET status = 'OPENED', opened_at = CURRENT_TIMESTAMP
      RETURNING *
    `;
    const result = await db.query(upsertQuery, [userId, taskId]);

    res.json({
      message: 'Task status updated to OPENED.',
      activity: result.rows[0],
      socialLink: taskCheck.rows[0].social_link
    });

  } catch (error) {
    console.error('Error opening task:', error);
    res.status(500).json({ error: 'Failed to record task open event.' });
  }
});

// 4. Completion Logic (with 20-second validation)
router.post('/tasks/:id/complete', async (req, res) => {
  const userId = req.user.id;
  const taskId = req.params.id;

  try {
    // Check if task exists and has not expired
    const taskCheck = await db.query('SELECT expiry_date, platform FROM tasks WHERE id = $1', [taskId]);
    if (taskCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found.' });
    }
    if (new Date(taskCheck.rows[0].expiry_date) < new Date()) {
      return res.status(400).json({ error: 'This task has expired and cannot be completed.' });
    }

    // Retrieve open activity
    const activityResult = await db.query(
      'SELECT * FROM task_activity WHERE user_id = $1 AND task_id = $2',
      [userId, taskId]
    );

    if (activityResult.rows.length === 0) {
      return res.status(400).json({ error: 'This task has not been opened yet.' });
    }

    const activity = activityResult.rows[0];

    if (activity.status === 'COMPLETED') {
      return res.status(400).json({ error: 'This task has already been completed.' });
    }

    if (activity.status !== 'OPENED') {
      return res.status(400).json({ error: 'Task status is invalid. Please open the task first.' });
    }

    // Validation: Current Time - Open Time (minimum 20 seconds)
    const openedTime = new Date(activity.opened_at).getTime();
    const currentTime = Date.now();
    const elapsedSeconds = (currentTime - openedTime) / 1000;

    if (elapsedSeconds < 20) {
      return res.status(400).json({
        error: 'Please spend at least 20 seconds engaging with the content before completing this task.'
      });
    }

    // Award 10 points to student and update activity
    // Use transaction to ensure consistency
    await db.query('BEGIN');

    // Increment user points
    await db.query('UPDATE users SET points = points + 10 WHERE id = $1', [userId]);

    // Update activity status to COMPLETED
    const timeSpent = Math.round(elapsedSeconds);
    const platform = taskCheck.rows[0].platform;
    const isYouTube = platform === 'YouTube';
    const updateActivityQuery = isYouTube
      ? `UPDATE task_activity
         SET status = 'COMPLETED', completed_at = CURRENT_TIMESTAMP, time_spent = $3, comment_status = 'Not Checked'
         WHERE user_id = $1 AND task_id = $2
         RETURNING *`
      : `UPDATE task_activity
         SET status = 'COMPLETED', completed_at = CURRENT_TIMESTAMP, time_spent = $3
         WHERE user_id = $1 AND task_id = $2
         RETURNING *`;
    const updatedActivity = await db.query(updateActivityQuery, [userId, taskId, timeSpent]);

    await db.query('COMMIT');

    res.json({
      message: 'Task completed successfully! +10 Points awarded.',
      activity: updatedActivity.rows[0]
    });

  } catch (error) {
    if (db) await db.query('ROLLBACK');
    console.error('Error completing task:', error);
    res.status(500).json({ error: 'An error occurred during task completion.' });
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
    res.status(500).json({ error: 'Failed to fetch leaderboard.' });
  }
});

// 6. Profile Info
router.get('/profile', async (req, res) => {
  const userId = req.user.id;

  try {
    // 1. Get basic user info
    const userResult = await db.query(
      'SELECT name, email, points, instagram_username, youtube_handle, linkedin_profile, facebook_profile, facebook_display_name FROM users WHERE id = $1', 
      [userId]
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }
    const user = userResult.rows[0];

    // 2. Count completed tasks
    const completedResult = await db.query(
      'SELECT COUNT(*)::int FROM task_activity WHERE user_id = $1 AND status = \'COMPLETED\'',
      [userId]
    );
    const completedCount = completedResult.rows[0].count;

    // 3. Count pending tasks (active tasks not completed by student)
    const pendingResult = await db.query(
      `SELECT COUNT(*)::int FROM tasks t
       LEFT JOIN task_activity ta ON ta.task_id = t.id AND ta.user_id = $1 AND ta.status = 'COMPLETED'
       WHERE t.expiry_date >= CURRENT_TIMESTAMP AND ta.id IS NULL`,
      [userId]
    );
    const pendingCount = pendingResult.rows[0].count;

    res.json({
      name: user.name,
      email: user.email,
      points: user.points,
      instagram_username: user.instagram_username,
      youtube_handle: user.youtube_handle,
      linkedin_profile: user.linkedin_profile,
      facebook_profile: user.facebook_profile,
      facebook_display_name: user.facebook_display_name,
      completedTasks: completedCount,
      pendingTasks: pendingCount
    });

  } catch (error) {
    console.error('Error fetching student profile:', error);
    res.status(500).json({ error: 'Failed to retrieve profile data.' });
  }
});

// Update Profile Social Settings
router.put('/profile/social', async (req, res) => {
  const userId = req.user.id;
  const { instagram_username, youtube_handle, linkedin_profile, facebook_profile, facebook_display_name } = req.body;

  try {
    const updateQuery = `
      UPDATE users
      SET instagram_username = $1, youtube_handle = $2, linkedin_profile = $3, facebook_profile = $4, facebook_display_name = $5
      WHERE id = $6
      RETURNING name, email, points, instagram_username, youtube_handle, linkedin_profile, facebook_profile, facebook_display_name
    `;
    const result = await db.query(updateQuery, [
      instagram_username ? instagram_username.trim() : null,
      youtube_handle ? youtube_handle.trim() : null,
      linkedin_profile ? linkedin_profile.trim() : null,
      facebook_profile ? facebook_profile.trim() : null,
      facebook_display_name ? facebook_display_name.trim() : null,
      userId
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    res.json({
      message: 'Social profiles updated successfully.',
      user: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating social profiles:', error);
    res.status(500).json({ error: 'Failed to update social profiles.' });
  }
});

function getYouTubeVideoId(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname;

    if (hostname === 'youtu.be') {
      const id = pathname.substring(1).split(/[?#]/)[0];
      return id.length === 11 ? id : null;
    }

    if (hostname.includes('youtube.com')) {
      if (pathname.startsWith('/shorts/') || pathname.startsWith('/embed/')) {
        const parts = pathname.split('/');
        const id = parts[2]?.split(/[?#]/)[0];
        return (id && id.length === 11) ? id : null;
      }
      if (pathname === '/watch') {
        const id = parsed.searchParams.get('v');
        return (id && id.length === 11) ? id : null;
      }
    }
    
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=|shorts\/)([^#\&\?]*).*/;
    const match = url.match(regExp);
    if (match && match[2] && match[2].length === 11) {
      return match[2];
    }
  } catch (e) {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=|shorts\/)([^#\&\?]*).*/;
    const match = url.match(regExp);
    if (match && match[2] && match[2].length === 11) {
      return match[2];
    }
  }
  return null;
}

function matchYouTubeHandle(authorName, userHandle) {
  if (!authorName || !userHandle) return { isMatch: false, cleanA: '', cleanB: '' };

  const clean = (s) => s.toLowerCase().replace(/@/g, '').replace(/\s+/g, '');
  
  const cleanA = clean(authorName);
  const cleanB = clean(userHandle);

  let isMatch = false;

  if (cleanA === cleanB) {
    isMatch = true;
  } else {
    const stripSpecial = (s) => s.replace(/[^a-z0-9]/g, '');
    if (stripSpecial(cleanA) === stripSpecial(cleanB)) {
      isMatch = true;
    } else {
      const hasSuffixMatch = (str, base) => {
        const regex = new RegExp('^' + base + '[-_][a-z0-9]*[0-9][a-z0-9]*$');
        return regex.test(str);
      };

      const hasStrippedSuffixMatch = (str, base) => {
        const strippedStr = stripSpecial(str);
        const strippedBase = stripSpecial(base);
        if (strippedStr.startsWith(strippedBase)) {
          const suffix = strippedStr.substring(strippedBase.length);
          const hasDigit = /[0-9]/.test(suffix);
          const suffixRegex = new RegExp('[-_]' + suffix + '$');
          return hasDigit && suffixRegex.test(str) && suffix.length >= 2 && suffix.length <= 7;
        }
        return false;
      };

      isMatch = hasSuffixMatch(cleanA, cleanB) || hasSuffixMatch(cleanB, cleanA) ||
                hasStrippedSuffixMatch(cleanA, cleanB) || hasStrippedSuffixMatch(cleanB, cleanA);
    }
  }

  return { isMatch, cleanA, cleanB };
}

async function fetchYouTubeComments(videoId, apiKey) {
  const url = `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=${videoId}&maxResults=100&key=${apiKey}`;
  
  console.log(`\n[YOUTUBE API REQUEST]`);
  console.log(`Video ID: ${videoId}`);
  console.log(`Endpoint: https://www.googleapis.com/youtube/v3/commentThreads`);
  console.log(`Query Parameters: part=snippet, videoId=${videoId}, maxResults=100, key=***`);

  let response;
  try {
    response = await fetch(url);
  } catch (netErr) {
    console.error(`[YOUTUBE API ERROR] Network Error:`, netErr.message);
    try {
      await db.query('INSERT INTO youtube_api_usage (request_type, quota_cost, status, response_code) VALUES ($1, $2, $3, $4)', ['commentThreads.list', 1, 'failed', null]);
    } catch (e) {
      console.error('Failed to log YouTube API usage:', e);
    }
    const err = new Error(`Network Error: ${netErr.message}`);
    err.apiStatus = 'NETWORK_ERROR';
    err.reason = 'Network Error';
    throw err;
  }
  
  try {
    await db.query('INSERT INTO youtube_api_usage (request_type, quota_cost, status, response_code) VALUES ($1, $2, $3, $4)', ['commentThreads.list', 1, response.ok ? 'success' : 'failed', response.status]);
  } catch (e) {
    console.error('Failed to log YouTube API usage:', e);
  }

  if (global.youtubeApiStatus) {
    global.youtubeApiStatus.lastAttempt = new Date();
    global.youtubeApiStatus.lastResponseStatus = response.status;
  }
  
  const data = await response.json();

  if (!response.ok) {
    console.error(`\n[YOUTUBE API RESPONSE ERROR]`);
    console.error(`HTTP Status: ${response.status}`);
    const errorCode = data.error?.code || 'UNKNOWN_CODE';
    const errorMessage = data.error?.message || 'Unknown error message';
    const reason = data.error?.errors?.[0]?.reason || 'unknown_reason';
    
    console.error(`Error Code: ${errorCode}`);
    console.error(`Error Message: ${errorMessage}`);
    console.error(`Reason: ${reason}`);
    console.error(`Full Body:`, JSON.stringify(data, null, 2));

    const err = new Error(errorMessage);
    err.apiStatus = response.status;
    err.errorCode = errorCode;
    err.reason = reason;
    throw err;
  }

  console.log(`\n[YOUTUBE API SUCCESS]`);
  console.log(`HTTP Status: ${response.status}`);
  const items = data.items || [];
  console.log(`Comments Retrieved Count: ${items.length}`);
  
  return items.map(item => ({
    author: item.snippet?.topLevelComment?.snippet?.authorDisplayName || 'Unknown',
    content: item.snippet?.topLevelComment?.snippet?.textDisplay || ''
  }));
}

// Diagnostic helper
async function logDiagnostic(data) {
  try {
    const insertQuery = `
      INSERT INTO verification_audit_logs 
      (task_id, student_id, student_name, youtube_handle, platform, video_id, source, comments_found, match_found, status, reason)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `;
    const values = [
      data.taskId || null,
      data.studentId || null,
      data.studentName || null,
      data.storedHandle || null,
      data.platform || 'YouTube',
      data.videoId || null,
      data.verificationSource || 'INTERNAL',
      data.retrievedCommentsCount || data.numComments || 0,
      data.matchResult || false,
      data.status || 'Unknown',
      data.reason || ''
    ];
    await db.query(insertQuery, values);
    
    // Implement Option B: Keep latest 5000 (run asynchronously to not block)
    db.query(`
      DELETE FROM verification_audit_logs 
      WHERE id NOT IN (
        SELECT id FROM verification_audit_logs ORDER BY timestamp DESC LIMIT 5000
      )
    `).catch(err => console.error('Error cleaning up audit logs:', err));
    
  } catch (err) {
    console.error('Error logging verification audit record:', err);
  }
}

// Verify Task Comment
router.post('/tasks/:id/verify-comment', async (req, res) => {
  const userId = req.user.id;
  const taskId = req.params.id;

  try {
    // 1. Check if the task activity exists and is completed
    const activityResult = await db.query(
      'SELECT * FROM task_activity WHERE user_id = $1 AND task_id = $2',
      [userId, taskId]
    );

    if (activityResult.rows.length === 0 || activityResult.rows[0].status !== 'COMPLETED') {
      return res.status(400).json({ error: 'Task must be completed before verifying the comment.' });
    }

    const activity = activityResult.rows[0];

    // 2. Check if already verified
    if (['Comment Detected', 'Comment Verified', 'Verification Successful'].includes(activity.comment_status) || activity.comment_points_awarded > 0) {
      return res.status(400).json({ error: 'Comment points already awarded for this task.' });
    }

    // 3. Fetch the platform of the task
    const taskResult = await db.query('SELECT platform, social_link FROM tasks WHERE id = $1', [taskId]);
    if (taskResult.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found.' });
    }
    const platform = taskResult.rows[0].platform;
    const socialLink = taskResult.rows[0].social_link;

    // 4. Fetch user details to get the relevant handle
    const userResult = await db.query(
      'SELECT name, instagram_username, youtube_handle, linkedin_profile, facebook_profile, facebook_display_name FROM users WHERE id = $1',
      [userId]
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }
    const user = userResult.rows[0];

    // Map platform to handle
    let handle = null;
    if (platform === 'Instagram') handle = user.instagram_username;
    else if (platform === 'YouTube') handle = user.youtube_handle;
    else if (platform === 'LinkedIn') handle = user.linkedin_profile;
    else if (platform === 'Facebook') handle = user.facebook_display_name;

    const diagBase = {
      taskId: taskId,
      taskUrl: socialLink,
      videoId: null,
      studentId: userId,
      studentName: user.name,
      storedHandle: handle,
      numComments: 0,
      authorsRetrieved: 'None',
      matchResult: false,
      status: 'Pending',
      reason: ''
    };

    // 5. If handle is not available
    if (platform === 'YouTube' && (!user.youtube_handle || user.youtube_handle.trim() === '')) {
      const status = 'YouTube Account Not Available';
      await db.query("UPDATE task_activity SET comment_status = $1 WHERE user_id = $2 AND task_id = $3", [status, userId, taskId]);
      logDiagnostic({ ...diagBase, status: status, reason: 'No YouTube handle set in profile' });
      return res.json({
        message: 'Please add your YouTube handle in Profile Settings before using comment verification.',
        comment_status: status
      });
    }

    if (platform !== 'YouTube' && platform !== 'Facebook' && (!handle || handle.trim() === '')) {
      await db.query("UPDATE task_activity SET comment_status = 'Platform Not Available' WHERE user_id = $1 AND task_id = $2", [userId, taskId]);
      return res.json({
        message: `Your ${platform} handle/profile is not configured. Please add it in Profile settings.`,
        comment_status: 'Platform Not Available'
      });
    }

    if (platform === 'Facebook' && (!handle || handle.trim() === '')) {
      const status = 'Facebook Account Not Available';
      await db.query("UPDATE task_activity SET comment_status = $1 WHERE user_id = $2 AND task_id = $3", [status, userId, taskId]);
      logDiagnostic({ ...diagBase, status: status, reason: 'No Facebook Display Name set in profile' });
      return res.status(400).json({
        message: 'Please add your exact Facebook Display Name in Profile Settings before using comment verification.',
        comment_status: status
      });
    }

    // 6. Platform verification logic
    if (platform === 'YouTube') {
      if (!socialLink || socialLink.trim() === '') {
        const status = 'Video ID Extraction Failed';
        await db.query("UPDATE task_activity SET comment_status = $1 WHERE user_id = $2 AND task_id = $3", [status, userId, taskId]);
        logDiagnostic({ ...diagBase, status: status, reason: 'Task URL is empty or invalid' });
        return res.json({ message: 'Verification Error: Invalid URL.', comment_status: status });
      }

      const videoId = getYouTubeVideoId(socialLink);
      if (!videoId) {
        const status = 'Video ID Extraction Failed';
        await db.query("UPDATE task_activity SET comment_status = $1 WHERE user_id = $2 AND task_id = $3", [status, userId, taskId]);
        logDiagnostic({ ...diagBase, status: status, reason: 'Regex could not find 11-char video ID' });
        return res.json({ message: 'Failed to extract a valid YouTube video ID from the task link.', comment_status: status });
      }
      diagBase.videoId = videoId;

      console.log(`\n[DIAGNOSTIC] process.env.YOUTUBE_API_KEY exists: ${!!process.env.YOUTUBE_API_KEY ? 'TRUE' : 'FALSE'}\n`);

      const apiKey = process.env.YOUTUBE_API_KEY;
      let comments = [];
      let fetchError = null;
      let verificationSource = 'REAL_YOUTUBE_API';

      if (!apiKey) {
        verificationSource = 'CONFIGURATION_ERROR';
        const status = 'Configuration Error';
        await db.query("UPDATE task_activity SET comment_status = $1 WHERE user_id = $2 AND task_id = $3", [status, userId, taskId]);
        logDiagnostic({ ...diagBase, verificationSource, status: status, reason: 'YouTube API Key is missing from configuration' });
        return res.json({
          message: 'YouTube Comment Verification is not configured. Missing YOUTUBE_API_KEY.',
          comment_status: status
        });
      }

      try {
        comments = await fetchYouTubeComments(videoId, apiKey);
      } catch (apiError) {
        console.error('YouTube verification API error:', apiError.message);
        fetchError = apiError;
      }

      if (fetchError) {
        let status = 'Comments Not Accessible';
        let userMessage = 'Unable to retrieve comments for this video.';
        
        if (fetchError.apiStatus === 403) {
           if (fetchError.reason === 'commentsDisabled') {
             status = 'Comments Disabled';
             userMessage = 'Comments are disabled for this video.';
           } else if (fetchError.reason === 'quotaExceeded') {
             status = 'API Quota Exceeded';
             userMessage = 'YouTube API quota has been exceeded.';
           } else if (fetchError.reason === 'accessNotConfigured') {
             status = 'API Not Enabled';
             userMessage = 'YouTube Data API v3 is not enabled or Access Not Configured.';
           } else {
             status = 'Forbidden';
             userMessage = `Forbidden: ${fetchError.message}`;
           }
        } else if (fetchError.apiStatus === 404 || fetchError.reason === 'videoNotFound') {
           status = 'Video Not Found';
           userMessage = 'Verification Error: Video Not Found.';
        } else if (fetchError.apiStatus === 400 && (fetchError.reason === 'keyInvalid' || fetchError.message?.includes('API key not valid'))) {
           status = 'API Key Invalid';
           userMessage = 'The configured YouTube API Key is invalid.';
        } else if (fetchError.apiStatus === 'NETWORK_ERROR') {
           status = 'Network Error';
           userMessage = 'A network error occurred while contacting YouTube API.';
        }

        try {
          await db.query("UPDATE task_activity SET comment_status = $1 WHERE user_id = $2 AND task_id = $3", [status, userId, taskId]);
        } catch (dbErr) {
          global.lastDatabaseError = { message: dbErr.message, code: dbErr.code, detail: dbErr.detail };
          global.lastDatabaseQuery = `UPDATE task_activity SET comment_status = '${status}' WHERE user_id = ${userId} AND task_id = ${taskId}`;
          throw dbErr;
        }
        
        logDiagnostic({ 
          ...diagBase, 
          verificationSource, 
          apiErrorStatus: fetchError.apiStatus,
          apiErrorCode: fetchError.errorCode,
          apiErrorMessage: fetchError.message,
          status: status, 
          reason: fetchError.message 
        });
        return res.json({
          message: userMessage,
          comment_status: status
        });
      }

      if (!comments || comments.length === 0) {
        const status = 'No Comments Available';
        try {
          await db.query("UPDATE task_activity SET comment_status = $1 WHERE user_id = $2 AND task_id = $3", [status, userId, taskId]);
        } catch (dbErr) {
          global.lastDatabaseError = { message: dbErr.message, code: dbErr.code, detail: dbErr.detail };
          global.lastDatabaseQuery = `UPDATE task_activity SET comment_status = '${status}' WHERE user_id = ${userId} AND task_id = ${taskId}`;
          throw dbErr;
        }

        logDiagnostic({ ...diagBase, verificationSource, retrievedCommentsCount: 0, status: status, reason: 'YouTube API returned an empty list of comments for this video' });
        return res.json({ 
          message: 'No comments found on this video.', 
          comment_status: status 
        });
      }

      diagBase.numComments = comments.length;
      console.log(`\nComments Retrieved: ${comments.length}`);
      logDiagnostic({ ...diagBase, status: 'Comment Retrieval Successful', retrievedCommentsCount: comments.length, reason: 'Successfully fetched comments from YouTube API' });

      let matchedAuthor = null;
      let commentFound = false;
      let authorsList = [];

      for (const item of comments) {
        const authorName = item.snippet?.topLevelComment?.snippet?.authorDisplayName || item.author;
        if (authorName) {
          authorsList.push(authorName);
          const { isMatch, cleanA, cleanB } = matchYouTubeHandle(authorName, user.youtube_handle);
          if (isMatch) {
            matchedAuthor = authorName;
            commentFound = true;
            console.log(`\n[Author Matching Validation]\nStored YouTube Handle: ${user.youtube_handle}\nDetected Comment Author: ${authorName}\nNormalized Values: Stored(${cleanB}) vs Detected(${cleanA})\nMatch Result: TRUE`);
            break;
          } else {
            console.log(`[Author Matching Validation]\nStored YouTube Handle: ${user.youtube_handle}\nDetected Comment Author: ${authorName}\nNormalized Values: Stored(${cleanB}) vs Detected(${cleanA})\nMatch Result: FALSE`);
          }
        }
      }

      diagBase.authorsRetrieved = authorsList.join(', ');

      if (commentFound) {
        const status = 'Comment Verified';
        await db.query('BEGIN');
        await db.query('UPDATE users SET points = points + 5 WHERE id = $1', [userId]);
        await db.query(`
          UPDATE task_activity 
          SET comment_status = $1, 
              comment_verified_at = CURRENT_TIMESTAMP, 
              comment_points_awarded = 5 
          WHERE user_id = $2 AND task_id = $3
        `, [status, userId, taskId]);
        await db.query('COMMIT');

        logDiagnostic({ ...diagBase, verificationSource, matchResult: true, status: status, reason: `Successfully matched comment from ${matchedAuthor}` });

        return res.json({ message: 'Comment successfully verified! +5 Points awarded.', comment_status: status });
      } else {
        const status = 'Comment Not Found';
        await db.query("UPDATE task_activity SET comment_status = $1 WHERE user_id = $2 AND task_id = $3", [status, userId, taskId]);
        
        logDiagnostic({ ...diagBase, verificationSource, matchResult: false, status: status, reason: 'No matching comment found for your handle' });

        return res.json({ 
          message: 'YouTube handle mismatch: No matching comment found for your handle.', 
          comment_status: status 
        });
      }
    } else if (platform === 'Facebook') {
      if (!checkRateLimit(userId, taskId)) {
        const status = 'Rate Limited';
        await db.query("UPDATE task_activity SET comment_status = $1 WHERE user_id = $2 AND task_id = $3", [status, userId, taskId]);
        logDiagnostic({ ...diagBase, status: status, reason: 'Exceeded 3 attempts per 5 minutes' });
        return res.status(429).json({ message: 'Too many verification attempts. Please wait 5 minutes.', comment_status: status });
      }

      const postId = extractFacebookPostId(socialLink);
      if (!postId) {
        const status = 'Post ID Extraction Failed';
        await db.query("UPDATE task_activity SET comment_status = $1 WHERE user_id = $2 AND task_id = $3", [status, userId, taskId]);
        logDiagnostic({ ...diagBase, status: status, reason: 'Could not extract Post ID from URL' });
        return res.status(400).json({ message: 'Verification Error: Invalid Facebook URL or unsupported post format.', comment_status: status });
      }

      const fbToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
      if (!fbToken) {
        const status = 'Configuration Error';
        await db.query("UPDATE task_activity SET comment_status = $1 WHERE user_id = $2 AND task_id = $3", [status, userId, taskId]);
        logDiagnostic({ ...diagBase, status: status, reason: 'Missing FACEBOOK_PAGE_ACCESS_TOKEN' });
        return res.status(503).json({ message: 'Facebook Comment Verification is not configured on the server.', comment_status: status });
      }

      let fbResponse;
      try {
        const fbUrl = `https://graph.facebook.com/v21.0/${postId}/comments?fields=from,message,created_time&access_token=${fbToken}`;
        fbResponse = await fetch(fbUrl);
      } catch (netErr) {
        await db.query("INSERT INTO facebook_api_usage (request_type, quota_cost, status, response_code, error_message) VALUES ($1, $2, $3, $4, $5)", ['GET comments', 1, 'failed', null, netErr.message]).catch(() => {});
        const status = 'Facebook API Error';
        await db.query("UPDATE task_activity SET comment_status = $1 WHERE user_id = $2 AND task_id = $3", [status, userId, taskId]);
        return res.status(500).json({ message: 'Network error connecting to Facebook API.', comment_status: status });
      }

      const fbData = await fbResponse.json();
      await db.query("INSERT INTO facebook_api_usage (request_type, quota_cost, status, response_code, error_message) VALUES ($1, $2, $3, $4, $5)", ['GET comments', 1, fbResponse.ok ? 'success' : 'failed', fbResponse.status, fbResponse.ok ? null : JSON.stringify(fbData.error)]).catch(() => {});
      
      if (global.facebookApiStatus) {
        global.facebookApiStatus.lastAttempt = new Date();
        global.facebookApiStatus.lastResponseStatus = fbResponse.status;
      }

      if (!fbResponse.ok) {
        let status = 'Facebook API Error';
        let httpCode = 500;
        let userMessage = 'Error connecting to Facebook API.';
        if (fbResponse.status === 404) {
          status = 'Post Not Found';
          httpCode = 404;
          userMessage = 'Facebook Post not found or is inaccessible.';
        } else if (fbResponse.status === 403) {
          status = 'Comments Not Accessible';
          httpCode = 403;
          userMessage = 'Permission denied retrieving comments for this post.';
        } else if (fbResponse.status === 400) {
          status = 'Configuration Error';
          httpCode = 503;
          userMessage = 'Facebook API Token or configuration is invalid.';
        }
        await db.query("UPDATE task_activity SET comment_status = $1 WHERE user_id = $2 AND task_id = $3", [status, userId, taskId]);
        logDiagnostic({ ...diagBase, status: status, reason: fbData.error?.message || 'API Error' });
        return res.status(httpCode).json({ message: userMessage, comment_status: status });
      }

      const comments = fbData.data || [];
      diagBase.numComments = comments.length;
      logDiagnostic({ ...diagBase, status: 'Comment Retrieval Successful', retrievedCommentsCount: comments.length, reason: 'Successfully fetched comments from Facebook API' });

      let matchFound = false;
      let matchedAuthor = null;
      let authorsList = [];

      for (const item of comments) {
        const commenterName = item.from?.name;
        if (commenterName) {
          authorsList.push(commenterName);
          if (matchFacebookName(handle, commenterName)) {
            matchFound = true;
            matchedAuthor = commenterName;
            break;
          }
        }
      }
      diagBase.authorsRetrieved = authorsList.join(', ');

      if (matchFound) {
        const status = 'Comment Verified';
        await db.query('BEGIN');
        await db.query('UPDATE users SET points = points + 5 WHERE id = $1', [userId]);
        await db.query(`
          UPDATE task_activity 
          SET comment_status = $1, 
              comment_verified_at = CURRENT_TIMESTAMP, 
              comment_points_awarded = 5 
          WHERE user_id = $2 AND task_id = $3
        `, [status, userId, taskId]);
        await db.query('COMMIT');
        logDiagnostic({ ...diagBase, matchResult: true, status: status, reason: `Successfully matched comment from ${matchedAuthor}` });
        return res.json({ message: 'Comment successfully verified! +5 Points awarded.', comment_status: status });
      } else {
        const status = 'Comment Not Found';
        await db.query("UPDATE task_activity SET comment_status = $1 WHERE user_id = $2 AND task_id = $3", [status, userId, taskId]);
        logDiagnostic({ ...diagBase, matchResult: false, status: status, reason: 'No matching comment found for your display name' });
        return res.status(404).json({ message: 'No matching comment found for your exact Facebook Display Name.', comment_status: status });
      }

    } else if (platform === 'Instagram') {
      await db.query('BEGIN');
      await db.query('UPDATE users SET points = points + 5 WHERE id = $1', [userId]);
      await db.query(
        "UPDATE task_activity SET comment_status = 'Comment Detected', comment_verified_at = CURRENT_TIMESTAMP, comment_points_awarded = 5 WHERE user_id = $1 AND task_id = $2",
        [userId, taskId]
      );
      await db.query('COMMIT');

      return res.json({ message: 'Comment successfully verified! +5 Points awarded.', comment_status: 'Comment Detected' });
    } else {
      await db.query("UPDATE task_activity SET comment_status = 'Comment Not Verified' WHERE user_id = $1 AND task_id = $2", [userId, taskId]);
      return res.json({ message: `Automatic comment verification is not available for ${platform}.`, comment_status: 'Comment Not Verified' });
    }

  } catch (error) {
    if (db) await db.query('ROLLBACK');
    console.error('\n--- DATABASE ERROR IN VERIFICATION ---');
    console.error('Full Error Message:', error.message);
    console.error('Error Code:', error.code);
    console.error('Stack Trace:', error.stack);
    
    global.lastDatabaseError = global.lastDatabaseError || { message: error.message, code: error.code };
    
    res.status(500).json({ 
      error: 'Failed to verify comment. Database error.',
      pgError: error.message,
      pgCode: error.code,
      failingQuery: global.lastDatabaseQuery || 'See server logs for query detail'
    });
  }
});

router.get('/system/verification-debug', async (req, res) => {
  try {
    const result = await db.query('SELECT status FROM verification_audit_logs ORDER BY timestamp DESC LIMIT 1');
    res.json({
      verificationStage: result.rows.length > 0 ? result.rows[0].status : 'None',
      databaseStatus: global.lastDatabaseError ? 'Error' : 'OK',
      lastVerificationError: global.lastDatabaseError,
      lastFailedQuery: global.lastDatabaseQuery
    });
  } catch (err) {
    res.json({
      verificationStage: 'Error fetching logs',
      databaseStatus: 'Error',
      lastVerificationError: err.message,
      lastFailedQuery: null
    });
  }
});

module.exports = router;
