import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';

import { ChapterInfo } from '@database/types';
import { useDeepLKey } from '@hooks/persisted/useDeepLKey';
import { useNovelSettings } from '@hooks/persisted/useNovelSettings';
import { TranslationError } from '@services/translation/deeplClient';
import { translateChapter } from '@services/translation/translateChapter';
import { translationErrorMessage } from '@services/translation/translationErrorMessage';
import { getGlossaryIdForPair } from '@services/translation/translationSettings';
import {
  deleteTranslation,
  listTranslatedChapterIds,
} from '@services/translation/translationStorage';
import { showToast } from '@utils/showToast';
import { useNovelValue } from '../NovelContext';

export type ChapterTranslationState = 'none' | 'translating' | 'saved';

interface Job {
  chapter: ChapterInfo;
  force: boolean;
}

const EMPTY = new Set<number>();

export function useChapterTranslations() {
  const novel = useNovelValue('novel');
  const { translation } = useNovelSettings();
  const { apiKey } = useDeepLKey();

  const pluginId = novel?.pluginId;
  const novelId = novel?.id;
  const sourceLang = translation?.sourceLang ?? '';
  const targetLang = translation?.targetLang ?? '';
  const pairKey = `${sourceLang}-${targetLang}`;
  const enabled = !!targetLang;

  const [savedIds, setSavedIds] = useState<Set<number>>(EMPTY);
  const [pendingIds, setPendingIds] = useState<Set<number>>(EMPTY);

  const queueRef = useRef<Job[]>([]);
  const pendingRef = useRef(new Set<number>());
  const runningRef = useRef(false);
  const pairKeyRef = useRef(pairKey);
  const translationRef = useRef(translation);
  const apiKeyRef = useRef(apiKey);
  const mountedRef = useRef(true);
  const loadTokenRef = useRef(0);

  useEffect(() => {
    pairKeyRef.current = pairKey;
    translationRef.current = translation;
    apiKeyRef.current = apiKey;
  }, [pairKey, translation, apiKey]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      queueRef.current = [];
    };
  }, []);

  const refreshSaved = useCallback(() => {
    const token = ++loadTokenRef.current;
    if (!enabled || !pluginId || novelId === undefined) {
      setSavedIds(EMPTY);
      return;
    }
    listTranslatedChapterIds(pluginId, novelId, sourceLang, targetLang)
      .then(ids => {
        if (mountedRef.current && token === loadTokenRef.current) {
          setSavedIds(ids);
        }
      })
      .catch(() => {});
  }, [enabled, pluginId, novelId, sourceLang, targetLang]);

  useFocusEffect(refreshSaved);

  const publishPending = () => setPendingIds(new Set(pendingRef.current));

  const runQueue = useCallback(async () => {
    if (runningRef.current) {
      return;
    }
    runningRef.current = true;
    while (queueRef.current.length) {
      const { chapter, force } = queueRef.current.shift()!;
      const settings = translationRef.current;
      const key = apiKeyRef.current;
      const jobPair = pairKeyRef.current;
      try {
        if (!settings || !key || !pluginId) {
          throw new TranslationError('unknown');
        }
        await translateChapter({
          apiKey: key,
          pluginId,
          novelId: chapter.novelId,
          chapter,
          sourceLang: settings.sourceLang,
          targetLang: settings.targetLang,
          glossaryId: getGlossaryIdForPair(settings),
          force,
        });
        if (mountedRef.current && pairKeyRef.current === jobPair) {
          setSavedIds(prev => new Set(prev).add(chapter.id));
        }
      } catch (e) {
        if (mountedRef.current) {
          showToast(
            translationErrorMessage(
              e instanceof TranslationError ? e.code : 'unknown',
            ),
          );
        }
      } finally {
        pendingRef.current.delete(chapter.id);
        if (mountedRef.current) {
          publishPending();
        }
      }
    }
    runningRef.current = false;
  }, [pluginId]);

  const enqueue = useCallback(
    (chapter: ChapterInfo, force: boolean) => {
      if (pendingRef.current.has(chapter.id)) {
        return;
      }
      pendingRef.current.add(chapter.id);
      queueRef.current.push({ chapter, force });
      publishPending();
      runQueue();
    },
    [runQueue],
  );

  const translate = useCallback(
    (chapter: ChapterInfo) => enqueue(chapter, false),
    [enqueue],
  );
  const retranslate = useCallback(
    (chapter: ChapterInfo) => enqueue(chapter, true),
    [enqueue],
  );

  const remove = useCallback(
    (chapter: ChapterInfo) => {
      if (!pluginId) {
        return;
      }
      deleteTranslation({
        pluginId,
        novelId: chapter.novelId,
        chapterId: chapter.id,
        sourceLang,
        targetLang,
      })
        .then(() => {
          if (mountedRef.current) {
            setSavedIds(prev => {
              const next = new Set(prev);
              next.delete(chapter.id);
              return next;
            });
          }
        })
        .catch(() => showToast(translationErrorMessage('unknown')));
    },
    [pluginId, sourceLang, targetLang],
  );

  const getState = useCallback(
    (chapterId: number): ChapterTranslationState | undefined => {
      if (!enabled) {
        return undefined;
      }
      if (pendingIds.has(chapterId)) {
        return 'translating';
      }
      if (savedIds.has(chapterId)) {
        return 'saved';
      }
      return apiKey ? 'none' : undefined;
    },
    [enabled, pendingIds, savedIds, apiKey],
  );

  return { getState, translate, retranslate, remove };
}
