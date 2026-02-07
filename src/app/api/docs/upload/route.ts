import { dbQuery, toPgVector } from '@/lib/db';
import { chunkTextByWords } from '@/lib/chunk';
import { embedMany } from 'ai';
import { openai } from '@ai-sdk/openai';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get('file');

    if (!file || !(file instanceof File)) {
      return Response.json({ error: 'Missing file' }, { status: 400 });
    }

    const filename = file.name;
    const bytes = new Uint8Array(await file.arrayBuffer());

    let text = '';
    const isPdf = filename.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf';

    if (isPdf) {
      // Dynamic import so the server doesn't crash for TXT uploads
      const { default: pdfParse } = await import('pdf-parse');
      const parsed = await pdfParse(Buffer.from(bytes));
      text = parsed.text || '';
    } else {
      text = await file.text();
    }

    text = text.replace(/\u0000/g, '').trim();
    if (!text) {
      return Response.json({ error: 'No text extracted from file' }, { status: 400 });
    }

    const chunks = chunkTextByWords(text);

    const docRes = await dbQuery<{ id: string }>(
      'insert into documents (filename) values ($1) returning id',
      [filename],
    );
    const documentId = Number(docRes.rows[0].id);

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

    return Response.json({ ok: true, documentId, chunks: chunks.length });
  } catch (e: any) {
    console.error('UPLOAD ERROR:', e);
    return Response.json(
      { error: 'Upload failed', detail: e?.message || String(e) },
      { status: 500 },
    );
  }
}
