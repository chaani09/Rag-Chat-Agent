import { dbQuery, toPgVector } from '@/lib/db';
import { getOcrText } from '@/lib/textract';
import { chunkTextByWords } from '@/lib/chunk';
import { embedMany } from 'ai';
import { openai } from '@ai-sdk/openai';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const { searchParams } = new URL(req.url);
  const docId = Number(searchParams.get('docId'));
  if (!Number.isFinite(docId)) return Response.json({ error: 'Invalid docId' }, { status: 400 });

  const r = await dbQuery<{ textract_job_id: string }>(
    'select textract_job_id from documents where id=$1 limit 1',
    [docId],
  );
  const jobId = r.rows[0]?.textract_job_id;
  if (!jobId) return Response.json({ error: 'No textract_job_id' }, { status: 404 });

  const { status, text } = await getOcrText(jobId);

  if (status === 'IN_PROGRESS') return Response.json({ ok: true, status: 'RUNNING' });

  if (status !== 'SUCCEEDED') {
    await dbQuery('update documents set ocr_status=$1, ocr_error=$2 where id=$3', [
      'FAILED',
      `Textract status=${status}`,
      docId,
    ]);
    return Response.json({ error: 'OCR failed', status }, { status: 500 });
  }

  const clean = (text || '').replace(/\u0000/g, '').trim();
  if (!clean) {
    await dbQuery('update documents set ocr_status=$1, ocr_error=$2 where id=$3', [
      'FAILED',
      'No text returned',
      docId,
    ]);
    return Response.json({ error: 'OCR returned empty text' }, { status: 500 });
  }

  // re-index chunks
  await dbQuery('delete from chunks where document_id=$1', [docId]);

  const chunks = chunkTextByWords(clean);
  const { embeddings } = await embedMany({
    model: openai.embedding('text-embedding-3-small'),
    values: chunks,
  });

  for (let i = 0; i < chunks.length; i++) {
    await dbQuery(
      `insert into chunks (document_id, chunk_index, content, embedding)
       values ($1, $2, $3, $4::vector)`,
      [docId, i, chunks[i], toPgVector(embeddings[i])],
    );
  }

  await dbQuery('update documents set ocr_status=$1, ocr_error=null where id=$2', [
    'SUCCEEDED',
    docId,
  ]);

  return Response.json({ ok: true, status: 'SUCCEEDED', chunks: chunks.length });
}
