import * as cheerio from 'cheerio';
import NativeFile from '@modules/native-file';
import { NOVEL_STORAGE } from '@utils/Storages';
import { fetchChapter } from '@services/plugin/fetch';
import { TranslationError, translateTexts } from './deeplClient';
import {
  SavedTranslation,
  readTranslation,
  writeTranslation,
} from './translationStorage';

// DeepL caps a request body at 128 KiB; up to 3 bytes per char plus headroom.
const MAX_REQUEST_CHARS = 30000;

export interface TranslateChapterParams {
  apiKey: string;
  pluginId: string;
  novelId: number;
  chapter: { id: number; path: string; name: string };
  sourceLang: string;
  targetLang: string;
  glossaryId?: string;
  force?: boolean;
}

export const splitChapterHtml = (
  html: string,
  maxChars = MAX_REQUEST_CHARS,
): string[] => {
  const $ = cheerio.load(html, null, false);
  const parts: string[] = [];
  let current = '';
  let hasContent = false;
  for (const node of $.root().contents().toArray()) {
    const piece = $.html(node);
    // A blank part comes back blank, which fails the whole chapter after DeepL
    // has billed the others, so whitespace always stays with a neighbour.
    const isWhitespace = node.type === 'text' && !$(node).text().trim();
    if (
      !isWhitespace &&
      hasContent &&
      current.length + piece.length > maxChars
    ) {
      parts.push(current);
      current = '';
      hasContent = false;
    }
    current += piece;
    hasContent = hasContent || !isWhitespace;
  }
  if (current) {
    parts.push(current);
  }
  return parts;
};

const loadSource = async (
  pluginId: string,
  novelId: number,
  chapter: { id: number; path: string },
): Promise<string> => {
  const filePath = `${NOVEL_STORAGE}/${pluginId}/${novelId}/${chapter.id}/index.html`;
  try {
    return await NativeFile.readFile(filePath);
  } catch {
    return await fetchChapter(pluginId, chapter.path);
  }
};

const isBlank = (html: string) =>
  !cheerio.load(html, null, false).root().text().trim() &&
  !/<(img|video|audio|svg|picture)\b/i.test(html);

const batchTexts = (texts: string[], maxChars: number): string[][] => {
  const batches: string[][] = [];
  let batch: string[] = [];
  let size = 0;
  for (const text of texts) {
    if (batch.length && size + text.length > maxChars) {
      batches.push(batch);
      batch = [];
      size = 0;
    }
    batch.push(text);
    size += text.length;
  }
  if (batch.length) {
    batches.push(batch);
  }
  return batches;
};

const run = async (
  params: TranslateChapterParams,
): Promise<SavedTranslation> => {
  const {
    apiKey,
    pluginId,
    novelId,
    chapter,
    sourceLang,
    targetLang,
    glossaryId,
  } = params;
  const ref = {
    pluginId,
    novelId,
    chapterId: chapter.id,
    sourceLang,
    targetLang,
  };

  if (!params.force) {
    const saved = await readTranslation(ref);
    if (saved) {
      return saved;
    }
  }

  const source = await loadSource(pluginId, novelId, chapter);
  if (isBlank(source)) {
    throw new TranslationError('empty_result');
  }

  const parts = splitChapterHtml(source);
  const translated: string[] = [];
  for (const batch of batchTexts([chapter.name, ...parts], MAX_REQUEST_CHARS)) {
    const result = await translateTexts(apiKey, {
      texts: batch,
      sourceLang,
      targetLang,
      glossaryId,
    });
    if (result.length !== batch.length) {
      throw new TranslationError('empty_result');
    }
    translated.push(...result);
  }
  if (translated.length !== parts.length + 1) {
    throw new TranslationError('empty_result');
  }

  const [title, ...html] = translated;
  const value: SavedTranslation = {
    html: html.join(''),
    title,
    ...(glossaryId ? { glossaryId } : {}),
    createdAt: new Date().toISOString(),
  };
  await writeTranslation(ref, value);
  return value;
};

const inFlight = new Map<string, Promise<SavedTranslation>>();

export const translateChapter = (
  params: TranslateChapterParams,
): Promise<SavedTranslation> => {
  const key = `${params.chapter.id}:${params.sourceLang}-${params.targetLang}`;
  const existing = inFlight.get(key);
  if (existing) {
    return existing;
  }
  const promise = run(params).finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
};
