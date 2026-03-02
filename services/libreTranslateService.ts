/**
 * LibreTranslate (and compatible) open-source translation API.
 * Public instance: https://libretranslate.com (or use self-hosted URL).
 */

const DEFAULT_BASE_URL = 'https://libretranslate.com';
const MAX_CHUNK_LEN = 4000;

export async function translateWithLibreTranslate(
  text: string,
  source: string = 'en',
  target: string = 'ko',
  baseUrl: string = DEFAULT_BASE_URL
): Promise<string> {
  if (!text || !text.trim()) return '';
  const trimmed = text.trim();
  if (trimmed.length <= MAX_CHUNK_LEN) {
    return translateChunk(trimmed, source, target, baseUrl);
  }
  const chunks = chunkText(trimmed, MAX_CHUNK_LEN);
  const results = await Promise.all(
    chunks.map((chunk) => translateChunk(chunk, source, target, baseUrl))
  );
  return results.join('\n\n');
}

function chunkText(text: string, maxLen: number): string[] {
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > 0) {
    if (rest.length <= maxLen) {
      chunks.push(rest);
      break;
    }
    const slice = rest.slice(0, maxLen);
    const lastBreak = Math.max(
      slice.lastIndexOf('\n\n'),
      slice.lastIndexOf('\n'),
      slice.lastIndexOf('. ')
    );
    const cut = lastBreak > maxLen * 0.5 ? lastBreak + 1 : maxLen;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  return chunks;
}

async function translateChunk(
  text: string,
  source: string,
  target: string,
  baseUrl: string
): Promise<string> {
  const url = `${baseUrl.replace(/\/$/, '')}/translate`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      q: text,
      source: source || 'en',
      target: target || 'ko',
      format: 'text',
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`LibreTranslate error ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.translatedText ?? '';
}

export interface OpenSourceTranslationPage {
  pageIndex: number;
  translated: string;
}

export async function translatePagesWithLibreTranslate(
  pages: { pageIndex: number; text: string }[],
  source: string = 'en',
  target: string = 'ko',
  baseUrl: string = DEFAULT_BASE_URL,
  onProgress?: (done: number, total: number) => void
): Promise<OpenSourceTranslationPage[]> {
  const result: OpenSourceTranslationPage[] = [];
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const translated = await translateWithLibreTranslate(
      page.text,
      source,
      target,
      baseUrl
    );
    result.push({ pageIndex: page.pageIndex, translated });
    onProgress?.(i + 1, pages.length);
  }
  return result;
}
