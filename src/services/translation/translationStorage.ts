import NativeFile from '@modules/native-file';
import { NOVEL_STORAGE } from '@utils/Storages';

export interface SavedTranslation {
  html: string;
  title: string;
  glossaryId?: string;
  createdAt: string;
}

export interface TranslationRef {
  pluginId: string;
  novelId: number;
  chapterId: number;
  sourceLang: string;
  targetLang: string;
}

const translationsDir = (pluginId: string, novelId: number) =>
  `${NOVEL_STORAGE}/${pluginId}/${novelId}/translations`;

const translationPath = (ref: TranslationRef) =>
  `${translationsDir(ref.pluginId, ref.novelId)}/${ref.chapterId}.${
    ref.sourceLang
  }-${ref.targetLang}.json`;

export const readTranslation = async (
  ref: TranslationRef,
): Promise<SavedTranslation | undefined> => {
  const path = translationPath(ref);
  try {
    if (!(await NativeFile.exists(path))) {
      return undefined;
    }
    return JSON.parse(await NativeFile.readFile(path)) as SavedTranslation;
  } catch {
    return undefined;
  }
};

export const writeTranslation = async (
  ref: TranslationRef,
  value: SavedTranslation,
): Promise<void> => {
  const dir = translationsDir(ref.pluginId, ref.novelId);
  const path = translationPath(ref);
  const tmp = `${path}.tmp`;
  if (!(await NativeFile.exists(dir))) {
    await NativeFile.mkdir(dir);
  }
  await NativeFile.writeFile(tmp, JSON.stringify(value));
  await NativeFile.moveFile(tmp, path);
};

export const deleteTranslation = async (ref: TranslationRef): Promise<void> => {
  const path = translationPath(ref);
  if (await NativeFile.exists(path)) {
    await NativeFile.unlink(path);
  }
};

export const listTranslatedChapterIds = async (
  pluginId: string,
  novelId: number,
  sourceLang: string,
  targetLang: string,
): Promise<Set<number>> => {
  const dir = translationsDir(pluginId, novelId);
  const ids = new Set<number>();
  if (!(await NativeFile.exists(dir))) {
    return ids;
  }
  const suffix = `.${sourceLang}-${targetLang}.json`;
  for (const entry of await NativeFile.readDir(dir)) {
    if (entry.isDirectory || !entry.name.endsWith(suffix)) {
      continue;
    }
    const id = entry.name.slice(0, -suffix.length);
    if (/^\d+$/.test(id)) {
      ids.add(Number(id));
    }
  }
  return ids;
};
