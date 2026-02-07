import { dbQuery } from '@/lib/db';

export const runtime = 'nodejs';

export async function GET() {
  const r = await dbQuery<{
    id: number;
    filename: string;
    mime_type: string | null;
    size_bytes: number | null;
  }>(
    `select id, filename, mime_type, size_bytes
     from documents
     order by id desc
     limit 50`
  );

  return Response.json({ documents: r.rows });
}
