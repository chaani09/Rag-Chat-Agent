import { dbQuery, toPgVector } from '@/lib/db';
import { chunkTextByWords } from '@/lib/chunk';
import { embedMany } from 'ai';
import { openai } from '@ai-sdk/openai';
import { buildS3Key, putFileToS3 } from '@/lib/s3';

export const runtime = 'nodejs';

async function indexText(documentId: number, text: string) {
  const clean = text.replace(/\u0000/g, '').trim();
  if (!clean) throw new Error('No text to index');

  // reset chunks for this doc
  await dbQuery('delete from chunks where document_id=$1', [documentId]);

  const chunks = chunkTextByWords(clean);

  const { embeddings } = await embedMany({
    model: openai.embedding('text-embedding-3-small'),
    values: chunks,
  });

  for (let i = 0; i < chunks.length; i++) {
    await dbQuery(
      `insert into chunks (document_id, chunk_index, content, embedding)
       values ($1, $2, $3, $4::vector)`,
      [documentId, i, chunks[i], toPgVector(embeddings[i])],
    );
  }

  return chunks.length;
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get('file');
    const extractedText = form.get('extractedText'); // optional (for text PDFs, later)

    if (!file || !(file instanceof File)) {
      return Response.json({ error: 'Missing file' }, { status: 400 });
    }

    const filename = file.name;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const isPdf = filename.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf';

    // 1) create document row
    const docRes = await dbQuery<{ id: string }>(
      'insert into documents (filename) values ($1) returning id',
      [filename],
    );
    const documentId = Number(docRes.rows[0].id);

    // 2) upload original to S3
    const key = buildS3Key(documentId, filename);
    const contentType = file.type || (isPdf ? 'application/pdf' : 'text/plain');

    await putFileToS3({
      key,
      body: Buffer.from(bytes),
      contentType,
    });

    await dbQuery(
      'update documents set s3_key=$1, mime_type=$2, size_bytes=$3 where id=$4',
      [key, contentType, bytes.length, documentId],
    );

    // 3) Index immediately for TXT (or if client passes extractedText)
    if (!isPdf) {
      const text = await file.text();
      const chunks = await indexText(documentId, text);
      return Response.json({ ok: true, documentId, chunks, needsOcr: false });
    }

    // PDF: if extractedText provided (optional optimization), index; else mark needs OCR
    if (typeof extractedText === 'string' && extractedText.trim()) {
      const chunks = await indexText(documentId, extractedText);
      return Response.json({ ok: true, documentId, chunks, needsOcr: false });
    }

    // PDF with no extractedText -> OCR required
    await dbQuery(
      'update documents set ocr_status=$1 where id=$2',
      ['PENDING', documentId],
    );

    return Response.json({ ok: true, documentId, chunks: 0, needsOcr: true });
  } catch (e: any) {
    console.error('UPLOAD ERROR:', e);
    return Response.json(
      { error: 'Upload failed', detail: e?.message || String(e) },
      { status: 500 },
    );
  }
}
