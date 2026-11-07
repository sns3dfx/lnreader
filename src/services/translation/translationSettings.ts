import type { NovelTranslationSettings } from '@hooks/persisted/useNovel/types';

export const getGlossaryPairKey = (
  sourceLang: string,
  targetLang: string,
): string => `${sourceLang}-${targetLang}`.toLowerCase();

export const getGlossaryIdForPair = (
  settings: NovelTranslationSettings,
): string | undefined =>
  settings.glossaries[
    getGlossaryPairKey(settings.sourceLang, settings.targetLang)
  ]
    ? settings.glossaryId
    : undefined;
