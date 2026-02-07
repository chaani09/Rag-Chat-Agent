import { dbQuery } from '@/lib/db';
import { getSignedObjectUrl } from '@/lib/s3';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const docId = Number(searchParams.get('docId'));
  const inline = searchParams.get('inline') === '1';

  if (!Number.isFinite(docId)) {
    return Response.json({ error: 'Invalid docId' }, { status: 400 });
  }

  const r = await dbQuery<{ s3_key: string; mime_type: string | null; filename: string }>(
    `select s3_key, mime_type, filename
     from documents
     where id=$1
     limit 1`,
    [docId],
  );

  const row = r.rows[0];
  if (!row?.s3_key) return Response.json({ error: 'No s3_key for this doc' }, { status: 404 });

  const url = await getSignedObjectUrl({
    key: row.s3_key,
    inline,
    responseContentType: row.mime_type || undefined,
    filename: row.filename,
    expiresInSeconds: 900,
  });

  return Response.json({ url });
}
