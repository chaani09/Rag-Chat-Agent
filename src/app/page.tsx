'use client';

import { useChat } from '@ai-sdk/react';
import { useEffect, useMemo, useState } from 'react';

type SourceRef = { docId?: number; chunk: number; file?: string };
type Evidence = { filename: string; chunk_index: number; content: string };

type DocRow = {
  id: number;
  filename: string;
  mime_type: string | null;
  size_bytes: number | null;
};

async function extractPdfTextInBrowser(file: File) {
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf');

  const data = new Uint8Array(await file.arrayBuffer());

  // Disable worker to avoid worker bundling issues in Next
  const loadingTask = pdfjs.getDocument({ data, disableWorker: true });
  const pdf = await loadingTask.promise;

  let out = '';
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const strings = content.items
      .map((it: any) => (typeof it.str === 'string' ? it.str : ''))
      .join(' ');
    out += strings + '\n';
  }

  return out.trim();
}

function messageText(m: any) {
  return (m.parts || [])
    .filter((p: any) => p.type === 'text')
    .map((p: any) => p.text)
    .join('');
}

function splitAnswerAndSources(full: string) {
  const idx = full.toLowerCase().lastIndexOf('\nsources:');
  if (idx === -1) return { answer: full, sourcesBlock: '' };
  return {
    answer: full.slice(0, idx).trimEnd(),
    sourcesBlock: full.slice(idx).trim(),
  };
}

function parseSources(sourcesBlock: string): Record<string, SourceRef> {
  const map: Record<string, SourceRef> = {};
  const lines = sourcesBlock.split('\n');

  for (const line of lines) {
    // New strict format: - S1: doc_id=123 file=AI-test.txt chunk=0
    let m = line.match(/S(\d+)\s*:\s*doc_id=(\d+).*?chunk=(\d+)/i);
    if (m) {
      const tag = `S${m[1]}`;
      map[tag] = { docId: Number(m[2]), chunk: Number(m[3]) };
      const f = line.match(/file=([^\s]+)/i);
      if (f) map[tag].file = f[1];
      continue;
    }

    // Old format: - S1: AI-test.txt, 0
    m = line.match(/S(\d+)\s*:\s*([^,]+),\s*(\d+)/i);
    if (m) {
      const tag = `S${m[1]}`;
      map[tag] = { chunk: Number(m[3]), file: m[2].trim() };
      continue;
    }
  }

  return map;
}

function renderWithCitations(text: string, onClick: (tag: string) => void) {
  const parts = text.split(/(\[S\d+\])/g);
  return parts.map((p, i) => {
    const m = p.match(/^\[(S\d+)\]$/);
    if (!m) return <span key={i}>{p}</span>;
    const tag = m[1];

    return (
      <button
        key={i}
        type="button"
        onClick={() => onClick(tag)}
        className="underline underline-offset-4 px-1 cursor-pointer"
        title={`Open ${tag} evidence`}
      >
        [{tag}]
      </button>
    );
  });
}

export default function Page() {
  const [input, setInput] = useState('');
  const [uploadStatus, setUploadStatus] = useState<string>('');

  const [docs, setDocs] = useState<DocRow[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<number | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>('');
  const [previewLoading, setPreviewLoading] = useState(false);

  const [evidence, setEvidence] = useState<(Evidence & { tag: string }) | null>(null);
  const [evidenceLoading, setEvidenceLoading] = useState(false);

  const { messages, sendMessage, error, isLoading } = useChat();

  async function refreshDocs(autoSelectId?: number) {
    const res = await fetch('/api/docs');
    const data = await res.json().catch(() => ({}));
    const list: DocRow[] = data.documents || [];
    setDocs(list);

    if (autoSelectId && list.some((d) => d.id === autoSelectId)) {
      await selectDoc(autoSelectId, list);
    } else if (!selectedDocId && list.length > 0) {
      await selectDoc(list[0].id, list);
    }
  }

  async function selectDoc(docId: number, listOverride?: DocRow[]) {
    setSelectedDocId(docId);
    setPreviewLoading(true);
    setPreviewUrl('');

    try {
      const res = await fetch(`/api/docs/file?docId=${docId}&inline=1`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to get preview URL');
      setPreviewUrl(data.url || '');
    } catch (e: any) {
      setPreviewUrl('');
      console.error(e);
    } finally {
      setPreviewLoading(false);
    }
  }

  useEffect(() => {
    refreshDocs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function uploadFile(file: File) {
  setUploadStatus('Uploading + indexing...');

  const fd = new FormData();
  fd.append('file', file);

  const filename = file.name.toLowerCase();
  const isPdf = filename.endsWith('.pdf') || file.type === 'application/pdf';

  if (isPdf) {
    setUploadStatus('Extracting PDF text in browser...');
    const extractedText = await extractPdfTextInBrowser(file);

    if (!extractedText) {
      setUploadStatus('Upload failed: This PDF has no extractable text (likely scanned).');
      return;
    }

    fd.append('extractedText', extractedText);
    setUploadStatus('Uploading + indexing...');
  }

  const res = await fetch('/api/docs/upload', { method: 'POST', body: fd });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    setUploadStatus(
      `Upload failed: ${data.detail ? `${data.error}: ${data.detail}` : data.error || res.statusText}`,
    );
    return;
  }

  setUploadStatus(`Indexed: ${file.name} (${data.chunks} chunks)`);
  // if you have refreshDocs(data.documentId) in your page, keep it
}


  const assistantSources = useMemo(() => {
    const out: Record<string, Record<string, SourceRef>> = {};
    for (const m of messages) {
      if (m.role !== 'assistant') continue;
      const full = messageText(m);
      const { sourcesBlock } = splitAnswerAndSources(full);
      out[m.id] = parseSources(sourcesBlock);
    }
    return out;
  }, [messages]);

  async function openEvidence(tag: string) {
    const assistants = messages.filter((m) => m.role === 'assistant');

    for (let i = assistants.length - 1; i >= 0; i--) {
      const msg = assistants[i];
      const map = assistantSources[msg.id] || {};
      const ref = map[tag];
      if (!ref) continue;

      setEvidenceLoading(true);
      try {
        const hasDocId = Number.isFinite(ref.docId);
        const url = hasDocId
          ? `/api/source?docId=${ref.docId}&chunk=${ref.chunk}`
          : `/api/source?file=${encodeURIComponent(ref.file || '')}&chunk=${ref.chunk}`;

        const res = await fetch(url);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || 'Failed to load evidence');
        setEvidence({ tag, ...data });
      } catch (e: any) {
        setEvidence({ tag, filename: 'Error', chunk_index: -1, content: e?.message || String(e) });
      } finally {
        setEvidenceLoading(false);
      }
      return;
    }

    setEvidence({
      tag,
      filename: 'Error',
      chunk_index: -1,
      content: 'No source mapping found. Ask again to regenerate Sources.',
    });
  }

  const selectedDoc = docs.find((d) => d.id === selectedDocId) || null;

  return (
    <div className="max-w-7xl mx-auto p-6 grid grid-cols-1 lg:grid-cols-4 gap-6">
      {/* LEFT: docs list */}
      <div className="border rounded p-4 space-y-3">
        <div className="font-semibold">Documents</div>

        <div className="space-y-2">
          <input
            type="file"
            accept=".pdf,.txt"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadFile(f);
            }}
          />
          <div className="text-sm opacity-80">{uploadStatus}</div>
        </div>

        <div className="pt-2 border-t space-y-2">
          {docs.length === 0 ? (
            <div className="text-sm opacity-70">No documents uploaded yet.</div>
          ) : (
            docs.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => selectDoc(d.id)}
                className={`w-full text-left border rounded px-3 py-2 ${
                  d.id === selectedDocId ? 'bg-zinc-100 dark:bg-zinc-900' : ''
                }`}
              >
                <div className="font-medium truncate">{d.filename}</div>
                <div className="text-xs opacity-70">
                  id {d.id}
                  {d.mime_type ? ` · ${d.mime_type}` : ''}
                  {typeof d.size_bytes === 'number' ? ` · ${Math.round(d.size_bytes / 1024)} KB` : ''}
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* MIDDLE: chat */}
      <div className="lg:col-span-2 border rounded p-4 space-y-4">
        <div className="font-semibold">Chat (click citations)</div>

        <div className="space-y-4">
          {messages.map((m) => {
            const full = messageText(m);
            const { answer } = splitAnswerAndSources(full);
            const srcMap = m.role === 'assistant' ? assistantSources[m.id] : {};

            return (
              <div key={m.id} className="whitespace-pre-wrap">
                <div className="text-xs opacity-60">{m.role.toUpperCase()}</div>

                {m.role === 'assistant' ? (
                  <>
                    <div>{renderWithCitations(answer, openEvidence)}</div>

                    {!!Object.keys(srcMap).length && (
                      <div className="mt-3 text-sm opacity-90">
                        <div className="font-semibold">Sources</div>
                        <div className="space-y-1">
                          {Object.entries(srcMap).map(([tag, ref]) => (
                            <button
                              key={tag}
                              type="button"
                              onClick={() => openEvidence(tag)}
                              className="underline underline-offset-4 block text-left cursor-pointer"
                            >
                              {tag} — {ref.file ? ref.file : `doc ${ref.docId}`} — chunk {ref.chunk}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div>{answer}</div>
                )}
              </div>
            );
          })}
        </div>

        {error ? <div className="text-sm text-red-600">Chat error: {String(error)}</div> : null}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!input.trim()) return;
            sendMessage({ text: input });
            setInput('');
          }}
          className="flex gap-2"
        >
          <input
            className="flex-1 border rounded p-2"
            value={input}
            onChange={(e) => setInput(e.currentTarget.value)}
            placeholder="Ask a question about your uploaded docs..."
            disabled={isLoading}
          />
          <button className="border rounded px-3" type="submit" disabled={isLoading}>
            Send
          </button>
        </form>
      </div>

      {/* RIGHT: preview + evidence */}
      <div className="space-y-6">
        <div className="border rounded p-4 space-y-3">
          <div className="font-semibold">File preview</div>
          <div className="text-sm opacity-80">
            {selectedDoc ? (
              <>
                <div className="font-medium truncate">{selectedDoc.filename}</div>
                <div className="text-xs opacity-70">docId {selectedDoc.id}</div>
              </>
            ) : (
              'Select a document.'
            )}
          </div>

          {previewLoading ? (
            <div className="text-sm opacity-70">Loading preview…</div>
          ) : previewUrl ? (
            <iframe
              src={previewUrl}
              className="w-full h-[420px] border rounded"
              title="File preview"
            />
          ) : (
            <div className="text-sm opacity-70">No preview URL yet.</div>
          )}

          {previewUrl ? (
            <a
              className="underline underline-offset-4 text-sm"
              href={previewUrl}
              target="_blank"
              rel="noreferrer"
            >
              Open in new tab
            </a>
          ) : null}
        </div>

        <div className="border rounded p-4">
          <div className="font-semibold">Evidence</div>

          {evidenceLoading ? (
            <div className="text-sm opacity-80 mt-2">Loading…</div>
          ) : evidence ? (
            <div className="mt-3 space-y-2">
              <div className="text-sm opacity-80">
                <div className="font-semibold">{evidence.tag}</div>
                <div>
                  {evidence.filename} · chunk {evidence.chunk_index}
                </div>
              </div>

              <pre className="text-xs whitespace-pre-wrap border rounded p-2 overflow-auto max-h-[260px]">
                {evidence.content}
              </pre>
            </div>
          ) : (
            <div className="text-sm opacity-80 mt-2">Click [S1] to view the exact chunk.</div>
          )}
        </div>
      </div>
    </div>
  );
}
