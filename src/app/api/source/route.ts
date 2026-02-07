import { dbQuery } from '@/lib/db';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const docIdRaw = searchParams.get('docId');
  const file = searchParams.get('file');
  const chunkRaw = searchParams.get('chunk');

  const chunkIndex = Number(chunkRaw);
  if (!Number.isFinite(chunkIndex)) {
    return Response.json({ error: 'Missing/invalid chunk' }, { status: 400 });
  }

  let docId = Number(docIdRaw);

  if (!Number.isFinite(docId)) {
    if (!file) return Response.json({ error: 'Missing docId or file' }, { status: 400 });

    const doc = await dbQuery<{ id: number }>(
      `select id from documents where filename = $1 order by id desc limit 1`,
      [file],
    );

    if (doc.rows.length === 0) {
      return Response.json({ error: 'Document not found for file' }, { status: 404 });
    }

    docId = Number(doc.rows[0].id);
  }

  const r = await dbQuery<{
    filename: string;
    chunk_index: number;
    content: string;
  }>(
    `
    select d.filename, c.chunk_index, c.content
    from chunks c
    join documents d on d.id = c.document_id
    where d.id = $1 and c.chunk_index = $2
    limit 1
    `,
    [docId, chunkIndex],
  );

  if (r.rows.length === 0) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  return Response.json(r.rows[0]);
}
