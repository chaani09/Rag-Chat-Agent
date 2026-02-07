import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is missing. Put it in .env.local in the project root.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

try {
  const r = await pool.query('select now() as now');
  console.log('DB connected:', r.rows[0]);
} catch (e) {
  console.error('DB error:', e.message);
  process.exit(1);
} finally {
  await pool.end();
}
