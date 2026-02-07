import { streamText, UIMessage, convertToModelMessages } from 'ai';
import { openai } from '@ai-sdk/openai';
import { embed } from 'ai';
import { dbQuery, toPgVector } from '@/lib/db';

export const runtime = 'nodejs';

type TopRow = {
  document_id: number;
  filename: string;
  chunk_index: number;
  content: string;
};

function lastUserText(messages: UIMessage[]) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'user') {
      const textPart = (m.parts as any[])?.find((p) => p.type === 'text');
      if (textPart?.text) return String(textPart.text);
    }
  }
  return '';
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const messages: UIMessage[] = body?.messages ?? [];
    const question = lastUserText(messages).trim() || ' ';

    const chunksCount = await dbQuery<{ count: string }>(
      'select count(*)::text as count from chunks',
    );

    if (Number(chunksCount.rows[0].count) === 0) {
      return Response.json({ error: 'Upload a PDF/TXT first.' }, { status: 400 });
    }

    const { embedding } = await embed({
      model: openai.embedding('text-embedding-3-small'),
      value: question,
    });

    const top = await dbQuery<TopRow>(
      `
      select d.id as document_id, d.filename, c.chunk_index, c.content
      from chunks c
      join documents d on d.id = c.document_id
      order by c.embedding <-> $1::vector
      limit 8
      `,
      [toPgVector(embedding)],
    );

    // Force correct row typing (prevents implicit-any in map on some TS configs)
    const rows: TopRow[] = top.rows;

    const sourceIndex = rows.map((r: TopRow, idx: number) => {
      return `- S${idx + 1}: doc_id=${r.document_id} file=${r.filename} chunk=${r.chunk_index}`;
    });

    const sources = rows.map((r: TopRow, idx: number) => {
      const tag = `S${idx + 1}`;
      const snippet = r.content.slice(0, 900);
      return `[${tag}] doc_id=${r.document_id} file=${r.filename} chunk=${r.chunk_index}\n${snippet}`;
    });

    const system = `
You answer ONLY using the SOURCES below.
If the answer is not in the sources, say: "I don't know based on the provided documents."
Cite sources inline like [S1] [S2].

After the answer, output this Sources list EXACTLY (copy verbatim):
Sources:
${sourceIndex.join('\n')}

SOURCES:
${sources.join('\n\n')}
`.trim();

    const result = streamText({
      model: openai('gpt-5-mini'),
      system,
      messages: await convertToModelMessages(messages),
      temperature: 0.2,
    });

    return result.toUIMessageStreamResponse();
  } catch (e: any) {
    console.error('CHAT ERROR:', e);
    return Response.json(
      { error: 'Chat failed', detail: e?.message || String(e) },
      { status: 500 },
    );
  }
}
