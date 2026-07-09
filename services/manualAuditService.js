const db = require('../db');

class ManualAuditService {
  /**
   * Submits a manual audit request for a given task and student.
   * Performs all business validations and identity snapshotting.
   */
  async submitAudit(userId, taskId) {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      
      const taskCheck = await client.query('SELECT * FROM tasks WHERE id = $1', [taskId]);
      if (taskCheck.rows.length === 0) {
        throw { status: 404, message: 'Task not found.' };
      }
      const task = taskCheck.rows[0];
      
      if (new Date(task.expiry_date) < new Date()) {
        throw { status: 400, message: 'This task has expired.' };
      }
      
      if (task.verification_method !== 'MANUAL') {
        throw { status: 400, message: 'This task does not support manual auditing.' };
      }

      const engagementsCheck = await client.query('SELECT id, engagement_type FROM task_engagements WHERE task_id = $1', [taskId]);
      if (engagementsCheck.rows.length === 0) {
         throw { status: 400, message: 'Task has no configured engagements.' };
      }
      
      const userCheck = await client.query('SELECT instagram_username, facebook_display_name, facebook_profile FROM users WHERE id = $1', [userId]);
      if (userCheck.rows.length === 0) {
        throw { status: 404, message: 'Student not found.' };
      }
      
      const user = userCheck.rows[0];
      let platformIdentifier = null;
      
      if (task.platform === 'Instagram') {
        platformIdentifier = user.instagram_username;
      } else if (task.platform === 'Facebook') {
        platformIdentifier = user.facebook_display_name || user.facebook_profile;
      }

      if (!platformIdentifier || platformIdentifier.trim() === '') {
        throw { status: 400, message: `Your ${task.platform} profile identifier is missing. Please update your profile settings first.` };
      }

      let firstAuditRec = null;

      for (const eng of engagementsCheck.rows) {
         const snapResult = await client.query(`
           INSERT INTO identity_snapshots (student_id, platform, platform_identifier, captured_at)
           VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
           RETURNING id
         `, [userId, task.platform, platformIdentifier]);
         const snapshotId = snapResult.rows[0].id;

         const saResult = await client.query(`
           INSERT INTO student_activities (user_id, task_engagement_id, status, created_at)
           VALUES ($1, $2, 'Submitted', CURRENT_TIMESTAMP)
           ON CONFLICT (user_id, task_engagement_id) DO UPDATE SET status = 'Submitted'
           RETURNING id
         `, [userId, eng.id]);
         
         const saId = saResult.rows[0].id;

         const existingAudit = await client.query(
           'SELECT status FROM manual_audits WHERE student_activity_id = $1 AND status != $2',
           [saId, 'REJECTED']
         );
         
         if (existingAudit.rows.length > 0) {
           throw { status: 400, message: 'Submission already exists for this task.' };
         }

         const insertQuery = `
           INSERT INTO manual_audits (student_activity_id, identity_snapshot_id, status)
           VALUES ($1, $2, 'PENDING')
           RETURNING *
         `;
         const maResult = await client.query(insertQuery, [saId, snapshotId]);
         
         if (!firstAuditRec) firstAuditRec = maResult.rows[0];
      }

      await client.query('COMMIT');
      return {
        duplicate: false,
        message: 'Manual audit request submitted successfully. It is now PENDING review.',
        audit: firstAuditRec
      };
    } catch (err) {
      await client.query('ROLLBACK');
      if (err.status) throw err;
      throw { status: 500, message: 'Failed to submit manual audit.', error: err.message };
    } finally {
      client.release();
    }
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
      SELECT 
        ma.id, ma.status, ma.is_selected_for_audit, ma.submitted_at, ma.reviewed_at,
        sa.id as student_activity_id, sa.status as activity_status,
        u.id as student_id, u.name as student_name, u.email as student_email,
        t.id as task_id, t.title as task_title, t.platform as task_platform,
        te.engagement_type,
        snap.platform as snapshot_platform, snap.platform_identifier as snapshot_identifier
      FROM manual_audits ma
      JOIN student_activities sa ON ma.student_activity_id = sa.id
      JOIN users u ON sa.user_id = u.id
      JOIN task_engagements te ON sa.task_engagement_id = te.id
      JOIN tasks t ON te.task_id = t.id
      LEFT JOIN identity_snapshots snap ON ma.identity_snapshot_id = snap.id
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
    
    query += ` ORDER BY ma.submitted_at ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit, 10) || 20);
    params.push(parseInt(offset, 10) || 0);

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
    
    await db.query("UPDATE manual_audits SET is_selected_for_audit = TRUE, status = 'UNDER_REVIEW' WHERE id = ANY($1)", [selectedIds]);
    
    return { message: `Successfully sampled ${sampleSize} audits.`, count: sampleSize };
  }

  _generateBusinessNote(task, user, engagementType, action, reason, adminName) {
    const actionText = action === 'approve' ? 'Approved' : 'Rejected';
    const dateStr = new Date().toISOString();
    let note = `[${dateStr}] Submission for Task "${task.title}" (${task.platform} - ${engagementType}) was ${actionText}.`;
    
    if (action === 'reject' && reason) {
      note += ` Reason: ${reason}.`;
    }
    
    if (adminName) {
      note += ` Reviewed by ${adminName}.`;
    }
    
    return note;
  }

  async batchReviewAudits(auditIds, action, reason, notes, reviewerId, reviewerName) {
    const results = {
      totalSelected: auditIds.length,
      successfullyProcessed: 0,
      failed: 0,
      skipped: 0,
      duplicateRequests: 0,
      details: []
    };

    const processedInBatch = new Set();

    for (const auditId of auditIds) {
      if (processedInBatch.has(auditId)) {
        results.duplicateRequests++;
        results.skipped++;
        results.details.push({ auditId, status: 'SKIPPED', message: 'Duplicate ID in request batch.' });
        continue;
      }
      processedInBatch.add(auditId);

      const client = await db.pool.connect();
      try {
        await client.query('BEGIN');
        
        const auditResult = await client.query(
          `SELECT ma.*, sa.user_id, sa.task_engagement_id, sa.status as activity_status,
                  te.points, te.engagement_type, te.task_id, t.title as task_title, t.platform as task_platform
           FROM manual_audits ma
           JOIN student_activities sa ON ma.student_activity_id = sa.id
           JOIN task_engagements te ON sa.task_engagement_id = te.id
           JOIN tasks t ON te.task_id = t.id
           WHERE ma.id = $1 FOR UPDATE`,
          [auditId]
        );

        if (auditResult.rows.length === 0) {
          results.failed++;
          results.details.push({ auditId, status: 'FAILED', message: 'Audit record not found.' });
          await client.query('ROLLBACK');
          continue;
        }

        const audit = auditResult.rows[0];

        if (!audit.identity_snapshot_id) {
          results.failed++;
          results.details.push({ auditId, status: 'FAILED', message: 'Missing immutable identity snapshot.' });
          await client.query('ROLLBACK');
          continue;
        }

        if (['APPROVED', 'REJECTED', 'CANCELLED'].includes(audit.status)) {
          results.skipped++;
          results.details.push({ auditId, status: 'SKIPPED', message: `Already in terminal state: ${audit.status}` });
          await client.query('ROLLBACK');
          continue;
        }

        const previousStatus = audit.status;
        const newStatus = action === 'approve' ? 'APPROVED' : 'REJECTED';
        const newActivityStatus = action === 'approve' ? 'Approved' : 'Rejected';
        
        const generatedNote = this._generateBusinessNote(
          { title: audit.task_title, platform: audit.task_platform },
          { id: audit.user_id },
          audit.engagement_type,
          action,
          action === 'reject' ? reason : null,
          reviewerName
        );

        await client.query(
          `UPDATE manual_audits SET status = $1, reviewed_at = CURRENT_TIMESTAMP WHERE id = $2`,
          [newStatus, auditId]
        );

        await client.query(
          `UPDATE student_activities SET status = $1, completed_at = CURRENT_TIMESTAMP WHERE id = $2`,
          [newActivityStatus, audit.student_activity_id]
        );

        if (action === 'approve' && audit.points > 0) {
          await client.query(
            `UPDATE users SET points = points + $1 WHERE id = $2`,
            [audit.points, audit.user_id]
          );
        }

        await client.query(
          `INSERT INTO review_logs (manual_audit_id, reviewer_id, outcome, rejection_reason, generated_note)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            auditId, 
            reviewerId, 
            newStatus, 
            action === 'reject' ? reason : null, 
            generatedNote
          ]
        );

        await client.query(
          `INSERT INTO manual_audit_history (audit_id, previous_status, new_status, reviewer_id, reason, notes)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            auditId, 
            previousStatus, 
            newStatus, 
            reviewerId, 
            action === 'reject' ? reason : null, 
            notes || null
          ]
        );

        await client.query('COMMIT');
        results.successfullyProcessed++;
        results.details.push({ auditId, status: 'SUCCESS', message: `Successfully ${action}d.` });

      } catch (error) {
        await client.query('ROLLBACK');
        console.error(`Transaction failed for auditId ${auditId}:`, error);
        results.failed++;
        results.details.push({ auditId, status: 'FAILED', message: error.message });
      } finally {
        client.release();
      }
    }

    return results;
  }

  async getStudentAudits(studentId) {
    const result = await db.query(
      `SELECT ma.id, ma.status, ma.is_selected_for_audit, ma.submitted_at, ma.reviewed_at,
              sa.id as student_activity_id, sa.status as activity_status,
              t.title as current_task_title, t.platform, te.engagement_type
       FROM manual_audits ma 
       JOIN student_activities sa ON ma.student_activity_id = sa.id
       JOIN task_engagements te ON sa.task_engagement_id = te.id
       JOIN tasks t ON te.task_id = t.id 
       WHERE sa.user_id = $1 
       ORDER BY ma.submitted_at DESC`,
      [studentId]
    );
    return result.rows;
  }
}

module.exports = new ManualAuditService();
