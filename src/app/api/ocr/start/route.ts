import { dbQuery } from '@/lib/db';
import { startOcrJob } from '@/lib/textract';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const { searchParams } = new URL(req.url);
  const docId = Number(searchParams.get('docId'));
  if (!Number.isFinite(docId)) return Response.json({ error: 'Invalid docId' }, { status: 400 });

  const r = await dbQuery<{ s3_key: string }>(
    'select s3_key from documents where id=$1 limit 1',
    [docId],
  );
  const s3Key = r.rows[0]?.s3_key;
  if (!s3Key) return Response.json({ error: 'No s3_key' }, { status: 404 });

  const jobId = await startOcrJob(s3Key);

  await dbQuery(
    'update documents set textract_job_id=$1, ocr_status=$2, ocr_error=null where id=$3',
    [jobId, 'RUNNING', docId],
  );

  return Response.json({ ok: true, jobId });
}
