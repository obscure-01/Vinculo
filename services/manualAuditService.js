const db = require('../db');

class ManualAuditService {
  /**
   * Submits a manual audit request for a specific engagement.
   * PHASE 1: Engagement-scoped lifecycle.
   * PHASE 2: Transaction boundaries and deterministic rules.
   */
  async submitEngagementAudit(userId, engagementId) {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      
      const engCheck = await client.query(`
        SELECT te.*, t.platform, t.expiry_date, t.status as task_status
        FROM task_engagements te
        JOIN tasks t ON te.task_id = t.id
        WHERE te.id = $1 AND te.verification_type = 'MANUAL'
        FOR SHARE
      `, [engagementId]);
      
      if (engCheck.rows.length === 0) {
        throw { status: 404, message: 'Engagement not found or is not manual.' };
      }
      const eng = engCheck.rows[0];
      
      if (eng.task_status === 'CANCELLED') {
         throw { status: 400, message: 'Task is cancelled.' };
      }
      
      if (new Date(eng.expiry_date) < new Date()) {
        throw { status: 400, message: 'This task has expired.' };
      }
      
      const userCheck = await client.query('SELECT instagram_username, facebook_display_name, facebook_profile FROM users WHERE id = $1', [userId]);
      if (userCheck.rows.length === 0) throw { status: 404, message: 'Student not found.' };
      const user = userCheck.rows[0];
      
      let platformIdentifier = null;
      if (eng.platform === 'Instagram') platformIdentifier = user.instagram_username;
      else if (eng.platform === 'Facebook') platformIdentifier = user.facebook_display_name || user.facebook_profile;

      if (!platformIdentifier || platformIdentifier.trim() === '') {
        throw { status: 400, message: `Your ${eng.platform} profile identifier is missing. Please update your profile settings first.` };
      }

      // 1. Ensure Student Activity exists. Use ON CONFLICT DO UPDATE so it's safely claimed.
      const saResult = await client.query(`
        INSERT INTO student_activities (user_id, task_engagement_id, status, created_at)
        VALUES ($1, $2, 'Submitted', CURRENT_TIMESTAMP)
        ON CONFLICT (user_id, task_engagement_id) DO UPDATE SET status = 'Submitted'
        RETURNING id
      `, [userId, engagementId]);
      const saId = saResult.rows[0].id;

      // 2. Lock Manual Audit
      const existingAudit = await client.query(
        'SELECT id, status FROM manual_audits WHERE student_activity_id = $1 FOR UPDATE',
        [saId]
      );
      
      let isResubmission = false;
      if (existingAudit.rows.length > 0) {
        const currentStatus = existingAudit.rows[0].status;
        if (currentStatus !== 'REJECTED' && currentStatus !== 'CANCELLED') {
          throw { status: 409, message: `Submission cannot be made because current status is ${currentStatus}.` };
        }
        isResubmission = true;
      }

      const snapResult = await client.query(`
        INSERT INTO identity_snapshots (student_id, platform, platform_identifier, captured_at)
        VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
        RETURNING id
      `, [userId, eng.platform, platformIdentifier]);
      const snapshotId = snapResult.rows[0].id;

      // 3. Upsert Manual Audit
      const maResult = await client.query(`
        INSERT INTO manual_audits (student_activity_id, identity_snapshot_id, status, submitted_at)
        VALUES ($1, $2, 'PENDING', CURRENT_TIMESTAMP)
        ON CONFLICT (student_activity_id) DO UPDATE SET 
          status = 'PENDING', 
          identity_snapshot_id = EXCLUDED.identity_snapshot_id, 
          submitted_at = CURRENT_TIMESTAMP
        RETURNING *
      `, [saId, snapshotId]);
      const auditId = maResult.rows[0].id;
      
      // 4. Write History inside same transaction
      await client.query(
        `INSERT INTO manual_audit_history (audit_id, previous_status, new_status, reason, notes)
         VALUES ($1, $2, $3, $4, $5)`,
        [auditId, isResubmission ? existingAudit.rows[0].status : null, 'PENDING', 'Student Submission', null]
      );
      
      await client.query('COMMIT');
      return {
        duplicate: false,
        message: 'Manual audit request submitted successfully. It is now PENDING review.',
        audit: maResult.rows[0]
      };
    } catch (err) {
      await client.query('ROLLBACK');
      if (err.status) throw err;
      throw { status: 500, message: 'Failed to submit manual audit.', error: err.message };
    } finally {
      client.release();
    }
  }

  // Backwards compatibility wrapper for Phase 3 legacy resolution (Option B)
  async submitAudit(userId, taskId) {
    const engagementsCheck = await db.query('SELECT id FROM task_engagements WHERE task_id = $1 AND verification_type = \'MANUAL\'', [taskId]);
    if (engagementsCheck.rows.length === 0) {
        throw { status: 400, message: 'Task has no manual engagements configured.' };
    }
    let lastResult = null;
    for (const eng of engagementsCheck.rows) {
        lastResult = await this.submitEngagementAudit(userId, eng.id);
    }
    return lastResult;
  }

  // PHASE 2: Safe Engagement-scoped withdrawal
  async withdrawEngagementAudit(userId, engagementId) {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      
      const saResult = await client.query(`
        SELECT id FROM student_activities WHERE user_id = $1 AND task_engagement_id = $2 FOR SHARE
      `, [userId, engagementId]);
      
      if (saResult.rows.length === 0) {
        throw { status: 404, message: 'Activity not found.' };
      }
      const saId = saResult.rows[0].id;
      
      const maResult = await client.query(`
        SELECT id, status FROM manual_audits WHERE student_activity_id = $1 FOR UPDATE
      `, [saId]);
      
      if (maResult.rows.length === 0) {
        throw { status: 404, message: 'Audit not found.' };
      }
      
      const audit = maResult.rows[0];
      if (audit.status !== 'PENDING') {
         throw { status: 409, message: `Cannot withdraw audit in status ${audit.status}` };
      }
      
      await client.query(`UPDATE manual_audits SET status = 'CANCELLED' WHERE id = $1`, [audit.id]);
      await client.query(`UPDATE student_activities SET status = 'Cancelled' WHERE id = $1`, [saId]);
      
      await client.query(`
         INSERT INTO manual_audit_history (audit_id, previous_status, new_status, reason, notes)
         VALUES ($1, $2, $3, $4, $5)
      `, [audit.id, 'PENDING', 'CANCELLED', 'Student Withdrew', null]);
      
      await client.query('COMMIT');
      return { message: 'Audit withdrawn successfully.' };
    } catch (err) {
      await client.query('ROLLBACK');
      if (err.status) throw err;
      throw { status: 500, message: 'Failed to withdraw audit.', error: err.message };
    } finally {
      client.release();
    }
  }

  // Legacy Withdraw
  async withdrawAudit(userId, taskId) {
    const engagementsCheck = await db.query('SELECT id FROM task_engagements WHERE task_id = $1 AND verification_type = \'MANUAL\'', [taskId]);
    let successCount = 0;
    for (const eng of engagementsCheck.rows) {
        try {
            await this.withdrawEngagementAudit(userId, eng.id);
            successCount++;
        } catch (err) {
           if (err.status !== 404 && err.status !== 409) throw err;
        }
    }
    if (successCount === 0) {
       throw { status: 409, message: 'Cannot withdraw task audit or already processed.' };
    }
    return { message: 'Manual audit request withdrawn.' };
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

  // PHASE 5: Batch Generation atomic
  async generateAuditBatch(options = {}) {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const countQuery = await client.query("SELECT COUNT(*) FROM manual_audits WHERE status = 'PENDING' AND is_selected_for_audit = FALSE");
      const totalPending = parseInt(countQuery.rows[0].count, 10);
      if (totalPending === 0) {
        await client.query('ROLLBACK');
        return { message: 'No pending unselected audits available to sample.', count: 0 };
      }
      
      
      let sampleSize = 0;
      if (options.count) {
        sampleSize = parseInt(options.count, 10);
      } else {
        const percentage = options.percentage || 25;
        sampleSize = Math.ceil(totalPending * (percentage / 100));
      }
      if (sampleSize < 1) sampleSize = 1;


      // Conditional claiming via RETURNING
      const updateResult = await client.query(`
        UPDATE manual_audits 
        SET is_selected_for_audit = TRUE, status = 'UNDER_REVIEW' 
        WHERE id IN (
          SELECT id FROM manual_audits 
          WHERE status = 'PENDING' AND is_selected_for_audit = FALSE 
          ORDER BY id ASC
          LIMIT $1 
          FOR UPDATE SKIP LOCKED
        )
        RETURNING id
      `, [sampleSize]);
      
      if (updateResult.rows.length > 0) {
         const ids = updateResult.rows.map(r => r.id);
         const values = ids.map((id, idx) => `($${idx * 5 + 1}, $${idx * 5 + 2}, $${idx * 5 + 3}, $${idx * 5 + 4}, $${idx * 5 + 5})`).join(', ');
         const flatParams = ids.flatMap(id => [id, 'PENDING', 'UNDER_REVIEW', 'System Batch Generation', null]);
         await client.query(`
           INSERT INTO manual_audit_history (audit_id, previous_status, new_status, reason, notes)
           VALUES ${values}
         `, flatParams);
      }
      
      await client.query('COMMIT');
      return { message: `Successfully sampled ${updateResult.rowCount} audits.`, count: updateResult.rowCount };
    } catch (err) {
      await client.query('ROLLBACK');
      throw { status: 500, error: 'Failed to generate batch.', originalError: err.message };
    } finally {
      client.release();
    }
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

  // PHASE 4: Batch Review deterministic lock order
  async batchReviewAudits(auditIds, action, reason, notes, reviewerId, reviewerName) {
    if (!auditIds || auditIds.length === 0) {
      throw { status: 400, error: 'Empty batch request.', auditId: null };
    }

    const processedInBatch = new Set();
    for (const auditId of auditIds) {
      if (processedInBatch.has(auditId)) {
        throw { status: 400, error: 'Validation failed for audit: Duplicate audit ID in batch request.', auditId };
      }
      processedInBatch.add(auditId);
    }
    
    // NORMALIZE -> DEDUPLICATE -> SORT
    const sortedAuditIds = [...auditIds].sort((a, b) => a - b);

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      // LOCK -> RE-READ -> VALIDATE ALL -> MUTATE -> HISTORY -> POINTS -> COMMIT
      for (const auditId of sortedAuditIds) {
        const auditResult = await client.query(
          `SELECT ma.*, sa.user_id, sa.task_engagement_id, sa.status as activity_status,
                  te.points, te.engagement_type, te.task_id, t.title as task_title, t.platform as task_platform
           FROM manual_audits ma
           JOIN student_activities sa ON ma.student_activity_id = sa.id
           JOIN task_engagements te ON sa.task_engagement_id = te.id
           JOIN tasks t ON te.task_id = t.id
           WHERE ma.id = $1 FOR UPDATE OF ma, sa, te`,
          [auditId]
        );

        if (auditResult.rows.length === 0) {
          throw { status: 400, error: 'Validation failed for audit: Audit record not found.', auditId };
        }

        const audit = auditResult.rows[0];

        if (!audit.identity_snapshot_id) {
          throw { status: 400, error: 'Validation failed for audit: Missing immutable identity snapshot.', auditId };
        }

        if (['APPROVED', 'REJECTED', 'CANCELLED'].includes(audit.status)) {
          throw { status: 400, error: `Validation failed for audit: Already in terminal state (${audit.status}).`, auditId };
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
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (manual_audit_id) DO UPDATE SET
             reviewer_id = EXCLUDED.reviewer_id,
             outcome = EXCLUDED.outcome,
             rejection_reason = EXCLUDED.rejection_reason,
             generated_note = EXCLUDED.generated_note,
             created_at = CURRENT_TIMESTAMP`,
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
      }

      await client.query('COMMIT');
      return { message: 'Batch review processed successfully.' };
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.status === 400) {
        throw error;
      }
      console.error('Batch transaction failed:', error);
      throw { status: 500, error: 'Database transaction failed.', originalError: error.message };
    } finally {
      client.release();
    }
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
