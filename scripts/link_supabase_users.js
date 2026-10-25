const { createClient } = require('@supabase/supabase-js');
const { Pool } = require('pg');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SECRET_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY are required.');
}

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function listAllAuthUsers() {
  const users = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 1000) return users;
  }
}

async function main() {
  const authUsers = await listAllAuthUsers();
  const localUsers = await pool.query(
    'SELECT id, email FROM users WHERE supabase_user_id IS NULL ORDER BY id'
  );
  let linked = 0;
  let skipped = 0;

  for (const localUser of localUsers.rows) {
    const authUser = authUsers.find(user => user.email?.toLowerCase() === localUser.email.toLowerCase());
    if (!authUser) {
      skipped += 1;
      console.log(`Skipped ${localUser.email}: no matching Supabase Auth user.`);
      continue;
    }

    await pool.query(
      'UPDATE users SET supabase_user_id = $1 WHERE id = $2 AND supabase_user_id IS NULL',
      [authUser.id, localUser.id]
    );
    linked += 1;
    console.log(`Linked ${localUser.email}.`);
  }

  console.log(`Finished. Linked: ${linked}; skipped: ${skipped}.`);
}

main()
  .catch(error => {
    console.error('Supabase user linking failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
