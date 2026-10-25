const db = require('../db');

class AuditAnalyticsService {

  // HELPER: Validate and parse pagination
  _getPagination(limit, offset) {
    let parsedLimit = parseInt(limit, 10);
    let parsedOffset = parseInt(offset, 10);
    
    if (isNaN(parsedLimit) || parsedLimit <= 0) parsedLimit = 20;
    if (parsedLimit > 100) parsedLimit = 100;
    
    if (isNaN(parsedOffset) || parsedOffset < 0) parsedOffset = 0;

    return { limit: parsedLimit, offset: parsedOffset };
  }

  // HELPER: Validate and parse sorting
  _getSorting(sortBy, sortDir, allowedColumns, defaultSortBy) {
    const direction = sortDir && sortDir.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    if (sortBy && !allowedColumns.includes(sortBy)) {
      throw { status: 400, message: `Invalid sort column. Allowed columns: ${allowedColumns.join(', ')}` };
    }
    let column = sortBy || defaultSortBy;
    return { sortBy: column, sortDir: direction };
  }

  /**
   * Review History (manual_audit_history)
   */
  async getReviewHistory(filters) {
    const { limit, offset } = this._getPagination(filters.limit, filters.offset);
    const { sortBy, sortDir } = this._getSorting(
      filters.sortBy, 
      filters.sortDir, 
      ['changed_at', 'new_status', 'previous_status', 'student_name', 'reviewer_name', 'task_title', 'platform'], 
      'changed_at'
    );

    let query = `
      SELECT 
        mah.id as history_id, mah.audit_id, mah.previous_status, mah.new_status, mah.changed_at, mah.reason, mah.notes,
        rev.id as reviewer_id, rev.name as reviewer_name,
        sa.user_id as student_id, stu.name as student_name,
        t.id as task_id, t.title as task_title, t.platform
      FROM manual_audit_history mah
      LEFT JOIN users rev ON mah.reviewer_id = rev.id
      JOIN manual_audits ma ON mah.audit_id = ma.id
      JOIN student_activities sa ON ma.student_activity_id = sa.id
      JOIN users stu ON sa.user_id = stu.id
      JOIN task_engagements te ON sa.task_engagement_id = te.id
      JOIN tasks t ON te.task_id = t.id
      WHERE 1=1
    `;
    const params = [];

    if (filters.auditId) {
      params.push(filters.auditId);
      query += ` AND mah.audit_id = $${params.length}`;
    }
    if (filters.student) {
      params.push(`%${filters.student}%`);
      query += ` AND stu.name ILIKE $${params.length}`;
    }
    if (filters.reviewer) {
      params.push(`%${filters.reviewer}%`);
      query += ` AND rev.name ILIKE $${params.length}`;
    }
    if (filters.task) {
      params.push(`%${filters.task}%`);
      query += ` AND t.title ILIKE $${params.length}`;
    }
    if (filters.platform) {
      params.push(filters.platform);
      query += ` AND t.platform = $${params.length}`;
    }
    if (filters.decision) {
      params.push(filters.decision);
      query += ` AND mah.new_status = $${params.length}`;
    }
    if (filters.startDate) {
      params.push(filters.startDate);
      query += ` AND mah.changed_at >= $${params.length}`;
    }
    if (filters.endDate) {
      params.push(filters.endDate);
      query += ` AND mah.changed_at <= $${params.length}`;
    }

    // Since we validated sortBy, we can safely interpolate it.
    let countQuery = `SELECT COUNT(*) FROM (${query}) AS sub`;
    query += ` ORDER BY ${sortBy} ${sortDir} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    
    const countParams = [...params];
    params.push(limit, offset);

    const result = await db.query(query, params);
    const countResult = await db.query(countQuery, countParams);

    return {
      data: result.rows,
      total: parseInt(countResult.rows[0].count, 10),
      limit,
      offset
    };
  }

  /**
   * Review Log Explorer (review_logs)
   */
  async getReviewLogs(filters) {
    const { limit, offset } = this._getPagination(filters.limit, filters.offset);
    const { sortBy, sortDir } = this._getSorting(
      filters.sortBy, 
      filters.sortDir, 
      ['created_at', 'outcome', 'rejection_reason', 'reviewer_name', 'student_name', 'task_title'], 
      'created_at'
    );

    let query = `
      SELECT 
        rl.id as log_id, rl.manual_audit_id as audit_id, rl.outcome, rl.rejection_reason, rl.generated_note, rl.created_at,
        rev.id as reviewer_id, rev.name as reviewer_name,
        sa.user_id as student_id, stu.name as student_name,
        t.id as task_id, t.title as task_title, t.platform,
        snap.platform_identifier as identity_snapshot_reference
      FROM review_logs rl
      LEFT JOIN users rev ON rl.reviewer_id = rev.id
      JOIN manual_audits ma ON rl.manual_audit_id = ma.id
      JOIN student_activities sa ON ma.student_activity_id = sa.id
      JOIN users stu ON sa.user_id = stu.id
      JOIN task_engagements te ON sa.task_engagement_id = te.id
      JOIN tasks t ON te.task_id = t.id
      LEFT JOIN identity_snapshots snap ON ma.identity_snapshot_id = snap.id
      WHERE 1=1
    `;
    const params = [];

    if (filters.auditId) {
      params.push(filters.auditId);
      query += ` AND rl.manual_audit_id = $${params.length}`;
    }
    if (filters.reviewerId) {
      params.push(filters.reviewerId);
      query += ` AND rl.reviewer_id = $${params.length}`;
    }
    if (filters.student) {
      params.push(`%${filters.student}%`);
      query += ` AND stu.name ILIKE $${params.length}`;
    }
    if (filters.task) {
      params.push(`%${filters.task}%`);
      query += ` AND t.title ILIKE $${params.length}`;
    }
    if (filters.decision) {
      params.push(filters.decision);
      query += ` AND rl.outcome = $${params.length}`;
    }
    if (filters.platform) {
      params.push(filters.platform);
      query += ` AND t.platform = $${params.length}`;
    }
    if (filters.reason) {
      params.push(`%${filters.reason}%`);
      query += ` AND rl.rejection_reason ILIKE $${params.length}`;
    }
    if (filters.search) {
      // Search across generated notes
      params.push(`%${filters.search}%`);
      query += ` AND rl.generated_note ILIKE $${params.length}`;
    }
    if (filters.startDate) {
      params.push(filters.startDate);
      query += ` AND rl.created_at >= $${params.length}`;
    }
    if (filters.endDate) {
      params.push(filters.endDate);
      query += ` AND rl.created_at <= $${params.length}`;
    }

    let countQuery = `SELECT COUNT(*) FROM (${query}) AS sub`;
    query += ` ORDER BY ${sortBy} ${sortDir} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;

    const countParams = [...params];
    params.push(limit, offset);

    const result = await db.query(query, params);
    const countResult = await db.query(countQuery, countParams);

    return {
      data: result.rows,
      total: parseInt(countResult.rows[0].count, 10),
      limit,
      offset
    };
  }

  /**
   * Student Verification Timeline (Lifecycle Reconstruction)
   */
  async getAuditTimeline(auditId) {
    // 1. Fetch core audit info to reconstruct current status and related entity timestamps
    const auditQuery = `
      SELECT 
        ma.id as audit_id, ma.status as current_status, ma.submitted_at,
        sa.created_at as activity_created_at, sa.completed_at as activity_completed_at,
        t.created_at as task_created_at
      FROM manual_audits ma
      JOIN student_activities sa ON ma.student_activity_id = sa.id
      JOIN task_engagements te ON sa.task_engagement_id = te.id
      JOIN tasks t ON te.task_id = t.id
      WHERE ma.id = $1
    `;
    const auditResult = await db.query(auditQuery, [auditId]);
    if (auditResult.rows.length === 0) {
      throw { status: 404, message: 'Audit not found.' };
    }
    const audit = auditResult.rows[0];

    const timeline = [];
    
    timeline.push({
      event: 'Task Created',
      timestamp: audit.task_created_at,
      details: null,
      _weight: 1
    });
    
    timeline.push({
      event: 'Student Opened / Engaged',
      timestamp: audit.activity_created_at,
      details: null,
      _weight: 2
    });

    timeline.push({
      event: 'Pending Review (Submitted)',
      timestamp: audit.submitted_at,
      details: null,
      _weight: 3
    });

    // 2. Fetch History Transitions
    const historyResult = await db.query(`
      SELECT previous_status, new_status, changed_at, reason, notes, rev.name as reviewer_name
      FROM manual_audit_history mah
      LEFT JOIN users rev ON mah.reviewer_id = rev.id
      WHERE audit_id = $1
      ORDER BY changed_at ASC
    `, [auditId]);

    historyResult.rows.forEach(h => {
      timeline.push({
        event: `Status Changed to ${h.new_status}`,
        timestamp: h.changed_at,
        details: {
          previousStatus: h.previous_status,
          reviewer: h.reviewer_name,
          reason: h.reason,
          notes: h.notes
        },
        _weight: 4
      });
    });

    // 3. Fetch Final Review Log (if exists)
    const logResult = await db.query(`
      SELECT outcome, rejection_reason, generated_note, created_at
      FROM review_logs
      WHERE manual_audit_id = $1
    `, [auditId]);

    if (logResult.rows.length > 0) {
      const log = logResult.rows[0];
      timeline.push({
        event: `Review Finalized (${log.outcome})`,
        timestamp: log.created_at,
        details: {
          rejectionReason: log.rejection_reason,
          note: log.generated_note
        },
        _weight: 5
      });
    }

    // Sort timeline chronologically, with deterministic fallback for identical timestamps
    timeline.sort((a, b) => {
      const diff = new Date(a.timestamp) - new Date(b.timestamp);
      if (diff !== 0) return diff;
      return a._weight - b._weight;
    });

    // Clean up internal properties before returning
    timeline.forEach(t => delete t._weight);

    return {
      auditId: parseInt(auditId, 10),
      currentStatus: audit.current_status,
      timeline
    };
  }

  /**
   * Queue Analytics
   */
  async getQueueAnalytics() {
    const queueQuery = `
      SELECT 
        COUNT(*) as current_pending_count,
        COALESCE(AVG(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - submitted_at))), 0) as average_pending_age_seconds,
        MIN(submitted_at) as oldest_pending,
        COUNT(*) FILTER (WHERE submitted_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours') as age_0_24h,
        COUNT(*) FILTER (WHERE submitted_at >= CURRENT_TIMESTAMP - INTERVAL '48 hours' AND submitted_at < CURRENT_TIMESTAMP - INTERVAL '24 hours') as age_24_48h,
        COUNT(*) FILTER (WHERE submitted_at >= CURRENT_TIMESTAMP - INTERVAL '72 hours' AND submitted_at < CURRENT_TIMESTAMP - INTERVAL '48 hours') as age_48_72h,
        COUNT(*) FILTER (WHERE submitted_at < CURRENT_TIMESTAMP - INTERVAL '72 hours') as age_72_plus
      FROM manual_audits
      WHERE status = 'PENDING' OR status = 'UNDER_REVIEW'
    `;
    const result = await db.query(queueQuery);
    const row = result.rows[0];

    return {
      currentPendingCount: parseInt(row.current_pending_count, 10),
      averagePendingAgeSeconds: parseFloat(row.average_pending_age_seconds),
      oldestPending: row.oldest_pending,
      agingBuckets: {
        '0-24_Hours': parseInt(row.age_0_24h, 10),
        '24-48_Hours': parseInt(row.age_24_48h, 10),
        '48-72_Hours': parseInt(row.age_48_72h, 10),
        '72+_Hours': parseInt(row.age_72_plus, 10)
      }
    };
  }

  /**
   * Performance Analytics
   */
  async getPerformanceAnalytics(filters = {}) {
    let baseWhere = `WHERE ma.reviewed_at IS NOT NULL`;
    const params = [];
    if (filters.startDate) {
      params.push(filters.startDate);
      baseWhere += ` AND ma.reviewed_at >= $${params.length}`;
    }
    if (filters.endDate) {
      params.push(filters.endDate);
      baseWhere += ` AND ma.reviewed_at <= $${params.length}`;
    }

    // Average & Median Review Time
    const timeQuery = `
      SELECT 
        COALESCE(AVG(EXTRACT(EPOCH FROM (ma.reviewed_at - ma.submitted_at))), 0) as avg_review_time,
        COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (ma.reviewed_at - ma.submitted_at))), 0) as median_review_time
      FROM manual_audits ma
      ${baseWhere}
    `;
    const timeResult = await db.query(timeQuery, params);

    // Platform Distribution
    const platformQuery = `
      SELECT t.platform, COUNT(ma.id) as count
      FROM manual_audits ma
      JOIN student_activities sa ON ma.student_activity_id = sa.id
      JOIN task_engagements te ON sa.task_engagement_id = te.id
      JOIN tasks t ON te.task_id = t.id
      ${baseWhere}
      GROUP BY t.platform
    `;
    const platformResult = await db.query(platformQuery, params);

    // Reviewer Distribution
    // Use review_logs created_at to approximate reviewed_at for reviewer distribution to avoid complex double JOINs.
    // Or we can just join review_logs to manual_audits in this specific query.
    const reviewerQuery = `
      SELECT rev.name as reviewer_name, COUNT(rl.id) as count
      FROM review_logs rl
      JOIN users rev ON rl.reviewer_id = rev.id
      JOIN manual_audits ma ON rl.manual_audit_id = ma.id
      ${baseWhere}
      GROUP BY rev.name
    `;
    const reviewerResult = await db.query(reviewerQuery, params);

    // Daily Reviews
    const dailyQuery = `
      SELECT DATE(ma.reviewed_at) as review_date, COUNT(ma.id) as count
      FROM manual_audits ma
      ${baseWhere}
      GROUP BY DATE(ma.reviewed_at)
      ORDER BY review_date ASC
    `;
    const dailyResult = await db.query(dailyQuery, params);

    // Approval / Rejection Rates
    const ratesQuery = `
      SELECT 
        COUNT(*) FILTER (WHERE rl.outcome = 'APPROVED') as approved_count,
        COUNT(*) FILTER (WHERE rl.outcome = 'REJECTED') as rejected_count,
        COUNT(rl.id) as total_reviews
      FROM review_logs rl
      JOIN manual_audits ma ON rl.manual_audit_id = ma.id
      ${baseWhere}
    `;
    const ratesResult = await db.query(ratesQuery, params);
    const ratesRow = ratesResult.rows[0];
    const totalReviews = parseInt(ratesRow.total_reviews, 10);
    const approvalRate = totalReviews > 0 ? (parseInt(ratesRow.approved_count, 10) / totalReviews) * 100 : 0;
    const rejectionRate = totalReviews > 0 ? (parseInt(ratesRow.rejected_count, 10) / totalReviews) * 100 : 0;

    return {
      averageReviewTimeSeconds: parseFloat(timeResult.rows[0].avg_review_time),
      medianReviewTimeSeconds: parseFloat(timeResult.rows[0].median_review_time),
      dailyReviews: dailyResult.rows.map(r => ({ date: r.review_date, count: parseInt(r.count, 10) })),
      platformDistribution: platformResult.rows.reduce((acc, curr) => { acc[curr.platform] = parseInt(curr.count, 10); return acc; }, {}),
      reviewerDistribution: reviewerResult.rows.reduce((acc, curr) => { acc[curr.reviewer_name] = parseInt(curr.count, 10); return acc; }, {}),
      rates: {
        totalReviews,
        approvedCount: parseInt(ratesRow.approved_count, 10),
        rejectedCount: parseInt(ratesRow.rejected_count, 10),
        approvalRatePercentage: approvalRate,
        rejectionRatePercentage: rejectionRate
      }
    };
  }
}

module.exports = new AuditAnalyticsService();
