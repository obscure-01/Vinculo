const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function runTestInit() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const client = await pool.connect();
    console.log('Connected to database. Running raw schema.sql and seed.sql...');
    
    // In order to drop tables, we just run schema.sql since it has DROP IF EXISTS
    const schemaSql = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
    await client.query(schemaSql);
    console.log('schema.sql executed.');
    
    const seedSql = fs.readFileSync(path.join(__dirname, '..', 'seed.sql'), 'utf8');
    await client.query(seedSql);
    console.log('seed.sql executed.');
    
    // Verify changes
    const res = await client.query('SELECT COUNT(*) FROM student_activities');
    console.log(`student_activities count after seed: ${res.rows[0].count}`);
    
    client.release();
    await pool.end();
  } catch (err) {
    console.error('Init test failed:', err);
    process.exit(1);
  }
}

runTestInit();
