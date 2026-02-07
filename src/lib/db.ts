import { Pool, type QueryResult, type QueryResultRow } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Optional hardening for serverless:
  // max: 5,
  // idleTimeoutMillis: 30_000,
  // connectionTimeoutMillis: 10_000,
  // ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
});

export async function dbQuery<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: any[] = [],
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params);
}

export function toPgVector(v: number[]) {
  // pgvector expects: '[1,2,3]'
  return `[${v.join(',')}]`;
}
