const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { after, before, test } = require('node:test');
const { Pool } = require('pg');

const databaseUrl = process.env.TEST_DATABASE_URL;
const testMarker = `integration-${process.pid}`;
const port = 3210 + (process.pid % 500);
const baseUrl = `http://127.0.0.1:${port}`;
let pool;
let serverProcess;

function requireTestDatabase() {
  if (!databaseUrl) {
    throw new Error('TEST_DATABASE_URL is required. Use a disposable local PostgreSQL database.');
  }
  const parsed = new URL(databaseUrl);
  if (parsed.hostname && !['localhost', '127.0.0.1'].includes(parsed.hostname)) {
    throw new Error('TEST_DATABASE_URL must point to localhost or 127.0.0.1.');
  }
}

async function request(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const body = await response.json().catch(() => null);
  return { response, body };
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const { response } = await request('/api/health');
      if (response.ok) return;
    } catch {
      // The server may still be applying the schema.
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Integration server did not become healthy.');
}

before(async () => {
  requireTestDatabase();
  pool = new Pool({ connectionString: databaseUrl });
  const schema = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  await pool.query(schema);

  const adminEmail = `admin-${testMarker}@example.test`;
  const studentEmail = `student-${testMarker}@example.test`;
  await pool.query('DELETE FROM users WHERE email IN ($1, $2)', [adminEmail, studentEmail]);

  await pool.query(
    `INSERT INTO users (name, email, password_hash, role, instagram_username)
     VALUES ($1, $2, NULL, 'Admin', NULL), ($3, $4, NULL, 'Student', $5)`,
    ['Integration Admin', adminEmail, 'Integration Student', studentEmail, `student_${testMarker}`]
  );

  serverProcess = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      PORT: String(port),
      NODE_ENV: 'test'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await waitForHealth();
});

after(async () => {
  if (serverProcess) serverProcess.kill('SIGTERM');
  if (pool) {
    await pool.query('DELETE FROM users WHERE email LIKE $1', [`%-${testMarker}@example.test`]);
    await pool.end();
  }
});

test('completes the authenticated manual-audit lifecycle', { skip: !process.env.TEST_SUPABASE_AUTH }, async () => {
  const unauthenticated = await request('/api/student/tasks');
  assert.equal(unauthenticated.response.status, 401);

  const headers = { 'Content-Type': 'application/json' };
  const adminEmail = `admin-${testMarker}@example.test`;
  const studentEmail = `student-${testMarker}@example.test`;
  const adminLogin = await request('/api/auth/login', {
    method: 'POST',
    headers,
    body: JSON.stringify({ email: adminEmail, password: 'IntegrationPassword!2026' })
  });
  const studentLogin = await request('/api/auth/login', {
    method: 'POST',
    headers,
    body: JSON.stringify({ email: studentEmail, password: 'IntegrationPassword!2026' })
  });
  assert.equal(adminLogin.response.status, 200);
  assert.equal(studentLogin.response.status, 200);

  const adminHeaders = { ...headers, Authorization: `Bearer ${adminLogin.body.token}` };
  const studentHeaders = { ...headers, Authorization: `Bearer ${studentLogin.body.token}` };
  const created = await request('/api/admin/tasks', {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      title: `Integration Task ${testMarker}`,
      platform: 'Instagram',
      socialLink: 'https://example.test/integration',
      durationDays: 7,
      engagementType: 'LIKE',
      verificationMethod: 'MANUAL'
    })
  });
  assert.equal(created.response.status, 201);
  const taskId = created.body.task.id;

  const taskList = await request('/api/student/tasks', { headers: studentHeaders });
  assert.equal(taskList.response.status, 200);
  const task = taskList.body.find(item => item.id === taskId);
  assert.ok(task);
  const manualEngagement = task.engagements.find(item => item.engagement_type === 'LIKE');
  assert.ok(manualEngagement);

  const opened = await request(`/api/student/tasks/${taskId}/open`, { method: 'POST', headers: studentHeaders });
  assert.equal(opened.response.status, 200);
  await pool.query(
    `UPDATE student_activities
     SET created_at = CURRENT_TIMESTAMP - INTERVAL '21 seconds'
     WHERE user_id = (SELECT id FROM users WHERE email = $1)
       AND task_engagement_id = (SELECT id FROM task_engagements WHERE task_id = $2 AND engagement_type = 'VISIT')`,
    [studentEmail, taskId]
  );

  const completed = await request(`/api/student/tasks/${taskId}/complete`, { method: 'POST', headers: studentHeaders });
  assert.equal(completed.response.status, 200);

  const submitted = await request(`/api/student/tasks/${taskId}/engagements/${manualEngagement.id}/manual-audit`, {
    method: 'POST',
    headers: studentHeaders
  });
  assert.equal(submitted.response.status, 201);

  const pending = await request('/api/admin/manual-audits?status=PENDING', { headers: adminHeaders });
  assert.equal(pending.response.status, 200);
  const audit = pending.body.data.find(item => item.id === submitted.body.audit.id);
  assert.ok(audit);

  const approved = await request('/api/admin/manual-audits/batch-review', {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ auditIds: [audit.id], action: 'approve' })
  });
  assert.equal(approved.response.status, 200);

  const state = await pool.query(
    `SELECT u.points, sa.status AS activity_status, ma.status AS audit_status, COUNT(mah.id)::int AS history_count
     FROM users u
     JOIN student_activities sa ON sa.user_id = u.id
     JOIN manual_audits ma ON ma.student_activity_id = sa.id
     LEFT JOIN manual_audit_history mah ON mah.audit_id = ma.id
     WHERE u.email = $1
     GROUP BY u.points, sa.status, ma.status`,
    [studentEmail]
  );
  assert.deepEqual(state.rows[0], {
    points: 25,
    activity_status: 'Approved',
    audit_status: 'APPROVED',
    history_count: 2
  });
});
