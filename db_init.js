const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

async function initializeDatabase() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is not set in .env');
    process.exit(1);
  }

  // Parse connection string to get the database name and connect to default postgres db first
  let defaultConnString = connectionString;
  let dbName = 'EngageHub';
  
  try {
    const url = new URL(connectionString);
    dbName = url.pathname.substring(1) || 'EngageHub';
    url.pathname = '/postgres'; // Redirect to default maintenance database
    defaultConnString = url.toString();
  } catch (e) {
    const match = connectionString.match(/\/([^/?]+)(\?|$)/);
    if (match) {
      dbName = match[1];
      defaultConnString = connectionString.replace(`/${dbName}`, '/postgres');
    }
  }

  console.log(`Connecting to default 'postgres' database to check/create '${dbName}'...`);
  const defaultPool = new Pool({ connectionString: defaultConnString });
  
  try {
    const defaultClient = await defaultPool.connect();
    
    // Check if target database exists
    const dbCheck = await defaultClient.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (dbCheck.rows.length === 0) {
      console.log(`Database '${dbName}' does not exist. Creating it...`);
      await defaultClient.query(`CREATE DATABASE "${dbName}"`);
      console.log(`Database '${dbName}' created successfully.`);
    } else {
      console.log(`Database '${dbName}' already exists.`);
    }
    
    defaultClient.release();
    await defaultPool.end();
  } catch (err) {
    console.warn(`Note: Could not check/create '${dbName}' via default DB:`, err.message);
    console.log('Proceeding to connect directly to the target database...');
    await defaultPool.end();
  }

async function isDatabaseEmpty(client) {
  for (const tableName of ['users', 'tasks', 'task_activity']) {
    const tableCheck = await client.query(
      'SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2)',
      ['public', tableName]
    );
    if (!tableCheck.rows[0].exists) continue;

    const countCheck = await client.query(`SELECT COUNT(*)::int AS count FROM ${tableName}`);
    if (countCheck.rows[0].count > 0) return false;
  }
  return true;
}

async function hasProductionData(client) {
  return !(await isDatabaseEmpty(client));
}

// Connect to the target database and execute migrations
  console.log(`Connecting directly to database '${dbName}' to run migrations...`);
  const targetPool = new Pool({ connectionString });
  try {
    const client = await targetPool.connect();

    console.log('Connected successfully. Applying safe schema updates...');
    const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await client.query(schemaSql);
    await client.query('ALTER TABLE tasks ADD COLUMN IF NOT EXISTS points INTEGER NOT NULL DEFAULT 10');
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'tasks'::regclass AND conname = 'tasks_points_range_check'
        ) THEN
          ALTER TABLE tasks ADD CONSTRAINT tasks_points_range_check CHECK (points BETWEEN 0 AND 10000);
        END IF;
      END $$;
    `);
    
    // Check if the database contains production data to protect it
    const hasProdData = await hasProductionData(client);
    if (hasProdData) {
      console.log('Database already contains user, task, or activity data. Skipping sample seed data.');
      client.release();
      await targetPool.end();
      process.exit(0);
    }

    console.log('Database tables initialized.');

    // Read and run seed.sql
    const seedSql = fs.readFileSync(path.join(__dirname, 'seed.sql'), 'utf8');
    await client.query(seedSql);
    console.log('Sample data seeded successfully.');

    client.release();
    await targetPool.end();
    console.log('Database initialization completed.');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ DATABASE INITIALIZATION ERROR:');
    console.error(error.message);
    console.error('\nTroubleshooting tips:');
    console.error('1. Make sure your PostgreSQL server is running locally on port 5432.');
    console.error('2. Verify that your database credentials in the .env file are correct.');
    console.error('3. Make sure the database user has permissions to create tables.');
    process.exit(1);
  }
}

initializeDatabase();
