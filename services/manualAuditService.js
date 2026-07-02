const db = require('../db');

class ManualAuditService {
  /**
   * Submits a manual audit request for a given task and student.
   * Performs all business validations and identity snapshotting.
   */
  async submitAudit(userId, taskId) {
    // 1. Validate task exists
    const taskCheck = await db.query('SELECT * FROM tasks WHERE id = $1', [taskId]);
    if (taskCheck.rows.length === 0) {
      throw { status: 404, message: 'Task not found.' };
    }
    
    const task = taskCheck.rows[0];
    
    // 2. Validate active and unexpired
    if (new Date(task.expiry_date) < new Date()) {
      throw { status: 400, message: 'This task has expired.' };
    }
    
    // 3. Validate verification method
    if (task.verification_method !== 'MANUAL') {
      throw { status: 400, message: 'This task does not support manual auditing.' };
    }

    // 4. Extract student platform identifier snapshot
    const userCheck = await db.query('SELECT instagram_username, facebook_display_name, facebook_profile FROM users WHERE id = $1', [userId]);
    if (userCheck.rows.length === 0) {
      throw { status: 404, message: 'Student not found.' };
    }
    
    const user = userCheck.rows[0];
    let platformIdentifier = null;
    
    if (task.platform === 'Instagram') {
      platformIdentifier = user.instagram_username;
    } else if (task.platform === 'Facebook') {
      // Prefer display name, fallback to profile URL/ID
      platformIdentifier = user.facebook_display_name || user.facebook_profile;
    }

    if (!platformIdentifier || platformIdentifier.trim() === '') {
      throw { status: 400, message: `Your ${task.platform} profile identifier is missing. Please update your profile settings first.` };
    }

    // 5. Check for duplicate submissions in manual_audits
    const existingAudit = await db.query(
      'SELECT status FROM manual_audits WHERE student_id = $1 AND task_id = $2 AND engagement_type = $3',
      [userId, taskId, task.engagement_type]
    );

    if (existingAudit.rows.length > 0) {
      // Graceful handling of duplicates, returning existing state
      return { 
        duplicate: true,
        message: 'Submission already exists.', 
        status: existingAudit.rows[0].status 
      };
    }

    // 6. Insert into manual_audits
    const insertQuery = `
      INSERT INTO manual_audits (student_id, task_id, task_title, task_platform, task_url, engagement_type, student_platform_identifier, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING')
      RETURNING *
    `;
    const result = await db.query(insertQuery, [
      userId, 
      taskId, 
      task.title, 
      task.platform, 
      task.social_link, 
      task.engagement_type,
      platformIdentifier
    ]);

    return {
      duplicate: false,
      message: 'Manual audit request submitted successfully. It is now PENDING review.',
      audit: result.rows[0]
    };
  }

  async getOverviewStats() {
    const statsQuery = `
      SELECT 
        COUNT(*) FILTER (WHERE status = 'PENDING') as pending,
        COUNT(*) FILTER (WHERE status = 'UNDER_REVIEW') as under_review,
        COUNT(*) FILTER (WHERE status = 'APPROVED') as approved,
        COUNT(*) FILTER (WHERE status = 'REJECTED') as rejected,
        COUNT(*) as total
      FROM manual_audits
    `;
    const result = await db.query(statsQuery);
    return result.rows[0];
  }

  async getManualAudits(limit, offset, status, isSelectedForAudit) {
    let query = `
      SELECT ma.*, u.name as student_name, u.email as student_email,
             u.instagram_username, u.facebook_display_name, u.facebook_profile, u.youtube_handle, u.linkedin_profile
      FROM manual_audits ma
      JOIN users u ON ma.student_id = u.id
      WHERE 1=1
    `;
    const params = [];
    
    if (status) {
      params.push(status);
      query += ` AND ma.status = $${params.length}`;
    }
    
    if (isSelectedForAudit !== undefined) {
      params.push(isSelectedForAudit === 'true');
      query += ` AND ma.is_selected_for_audit = $${params.length}`;
    }
    
    query += ` ORDER BY ma.submitted_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit, 10));
    params.push(parseInt(offset, 10));

    const result = await db.query(query, params);
    
    let countQuery = 'SELECT COUNT(*) as total FROM manual_audits WHERE 1=1';
    const countParams = [];
    if (status) {
      countParams.push(status);
      countQuery += ` AND status = $${countParams.length}`;
    }
    if (isSelectedForAudit !== undefined) {
      countParams.push(isSelectedForAudit === 'true');
      countQuery += ` AND is_selected_for_audit = $${countParams.length}`;
    }
    
    const countResult = await db.query(countQuery, countParams);
    
    return {
      data: result.rows,
      total: parseInt(countResult.rows[0].total, 10)
    };
  }

  async generateAuditBatch(percentage) {
    const pendingResult = await db.query("SELECT id FROM manual_audits WHERE status = 'PENDING' AND is_selected_for_audit = FALSE");
    const pendingIds = pendingResult.rows.map(r => r.id);
    
    if (pendingIds.length === 0) {
      return { message: 'No pending unselected audits available to sample.', count: 0 };
    }
    
    let sampleSize = Math.ceil(pendingIds.length * (percentage / 100));
    if (sampleSize < 1) sampleSize = 1;
    
    // Shuffle and pick
    for (let i = pendingIds.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pendingIds[i], pendingIds[j]] = [pendingIds[j], pendingIds[i]];
    }
    
    const selectedIds = pendingIds.slice(0, sampleSize);
    
    // Mark them as selected and switch to UNDER_REVIEW
    await db.query("UPDATE manual_audits SET is_selected_for_audit = TRUE, status = 'UNDER_REVIEW' WHERE id = ANY($1)", [selectedIds]);
    
    return { message: `Successfully sampled ${sampleSize} audits.`, count: sampleSize };
  }

  async batchReviewAudits(auditIds, action, reason, notes, reviewerId) {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      
      for (const auditId of auditIds) {
        const newStatus = action === 'approve' ? 'APPROVED' : 'REJECTED';
        
        // Ensure status is UNDER_REVIEW or PENDING
        const updateResult = await client.query(
          `UPDATE manual_audits 
           SET status = $1, reviewed_at = CURRENT_TIMESTAMP, reviewed_by = $2, rejection_reason = $3, admin_notes = $4
           WHERE id = $5 AND status IN ('PENDING', 'UNDER_REVIEW')
           RETURNING *`,
          [newStatus, reviewerId, action === 'reject' ? reason : null, notes || null, auditId]
        );
        
        if (updateResult.rowCount === 0) {
          throw new Error(`Audit ID ${auditId} could not be updated. It may have already been reviewed or does not exist.`);
        }
        
        const auditRec = updateResult.rows[0];
        
        await client.query(
          `INSERT INTO manual_audit_history (audit_id, previous_status, new_status, reviewer_id, reason, notes)
           VALUES ($1, 'UNDER_REVIEW', $2, $3, $4, $5)`,
          [auditId, newStatus, reviewerId, action === 'reject' ? reason : null, notes || null]
        );
        
        if (action === 'approve') {
          const points = 10;
          const existingActivity = await client.query('SELECT * FROM task_activity WHERE user_id = $1 AND task_id = $2', [auditRec.student_id, auditRec.task_id]);
          
          if (existingActivity.rows.length === 0) {
             await client.query(
              `INSERT INTO task_activity (user_id, task_id, status, completed_at, comment_status, comment_points_awarded) 
               VALUES ($1, $2, 'COMPLETED', CURRENT_TIMESTAMP, 'Verification Successful', $3)`,
              [auditRec.student_id, auditRec.task_id, points]
            );
            await client.query('UPDATE users SET points = points + $1 WHERE id = $2', [points, auditRec.student_id]);
          } else {
             const act = existingActivity.rows[0];
             if (act.status !== 'COMPLETED') {
               await client.query(
                 `UPDATE task_activity SET status = 'COMPLETED', completed_at = CURRENT_TIMESTAMP, comment_status = 'Verification Successful', comment_points_awarded = $1 
                  WHERE id = $2`, [points, act.id]
               );
               await client.query('UPDATE users SET points = points + $1 WHERE id = $2', [points, auditRec.student_id]);
             }
          }
        }
      }
      
      await client.query('COMMIT');
      return { message: `Successfully ${action}d ${auditIds.length} audits.` };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getStudentAudits(studentId) {
    const result = await db.query(
      `SELECT ma.*, t.title as current_task_title 
       FROM manual_audits ma 
       LEFT JOIN tasks t ON ma.task_id = t.id 
       WHERE ma.student_id = $1 
       ORDER BY ma.submitted_at DESC`,
      [studentId]
    );
    return result.rows;
  }
}

module.exports = new ManualAuditService();
