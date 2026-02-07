import { dbQuery, toPgVector } from '@/lib/db';
import { chunkTextByWords } from '@/lib/chunk';
import { embedMany } from 'ai';
import { openai } from '@ai-sdk/openai';
import { buildS3Key, putFileToS3 } from '@/lib/s3';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get('file');
    const extractedText = form.get('extractedText');

    if (!file || !(file instanceof File)) {
      return Response.json({ error: 'Missing file' }, { status: 400 });
    }

    const filename = file.name;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const isPdf = filename.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf';

    // For PDFs: require client-extracted text
    let text = '';
    if (isPdf) {
      if (typeof extractedText !== 'string' || !extractedText.trim()) {
        return Response.json(
          { error: 'PDF text missing. Enable client-side PDF text extraction.' },
          { status: 400 },
        );
      }
      text = extractedText;
    } else {
      text = await file.text();
    }

    text = text.replace(/\u0000/g, '').trim();
    if (!text) {
      return Response.json({ error: 'No text extracted from file' }, { status: 400 });
    }

    const chunks = chunkTextByWords(text);

    // 1) Create document row first
    const docRes = await dbQuery<{ id: string }>(
      'insert into documents (filename) values ($1) returning id',
      [filename],
    );
    const documentId = Number(docRes.rows[0].id);

    // 2) Upload original file to S3
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

    // 3) Embed + store chunks
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

    return Response.json({ ok: true, documentId, chunks: chunks.length, s3_key: key });
  } catch (e: any) {
    console.error('UPLOAD ERROR:', e);
    return Response.json(
      { error: 'Upload failed', detail: e?.message || String(e) },
      { status: 500 },
    );
  }
}
