export function chunkTextByWords(text: string, chunkWords = 220, overlapWords = 40) {
  const clean = text.replace(/\s+/g, ' ').trim();
  const words = clean.split(' ');
  const chunks: string[] = [];

  let i = 0;
  while (i < words.length) {
    const slice = words.slice(i, i + chunkWords);
    const chunk = slice.join(' ').trim();
    if (chunk) chunks.push(chunk);
    i += Math.max(1, chunkWords - overlapWords);
  }

  // Safety cap for today (prevents indexing massive docs accidentally)
  return chunks.slice(0, 80);
}
