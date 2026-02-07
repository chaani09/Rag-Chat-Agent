import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? undefined : { rejectUnauthorized: false },
});

export async function dbQuery<T = any>(text: string, params: any[] = []) {
  return pool.query<T>(text, params);
}

export function toPgVector(v: number[]) {
  return `[${v.join(',')}]`;
}
