import { act, renderHook, waitFor } from '@testing-library/react-native';

import { TranslationError } from '@services/translation/deeplClient';
import { translateChapter } from '@services/translation/translateChapter';
import {
  deleteTranslation,
  listTranslatedChapterIds,
} from '@services/translation/translationStorage';
import { showToast } from '@utils/showToast';
import type { NovelTranslationSettings } from '@hooks/persisted/useNovel/types';
import type { ChapterInfo } from '@database/types';

import { useChapterTranslations } from '../useChapterTranslations';

jest.mock('@services/translation/translateChapter', () => ({
  translateChapter: jest.fn(),
}));
jest.mock('@services/translation/translationStorage', () => ({
  deleteTranslation: jest.fn(),
  listTranslatedChapterIds: jest.fn(),
}));
jest.mock('@utils/showToast', () => ({ showToast: jest.fn() }));
jest.mock('@i18n/translations', () => ({ getString: (key: string) => key }));

let mockFocusCallback: (() => void) | undefined;
jest.mock('@react-navigation/native', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    useFocusEffect: (cb: () => void) => {
      mockFocusCallback = cb;
      useEffect(cb, [cb]);
    },
  };
});

let mockKey: string | undefined;
jest.mock('@hooks/persisted/useDeepLKey', () => ({
  useDeepLKey: () => ({ apiKey: mockKey }),
}));

let mockTranslation: NovelTranslationSettings | undefined;
jest.mock('@hooks/persisted/useNovelSettings', () => ({
  useNovelSettings: () => ({ translation: mockTranslation }),
}));

const mockNovel = { id: 1, pluginId: 'plug', name: 'Novel' };
jest.mock('../../NovelContext', () => ({
  useNovelValue: () => mockNovel,
}));

const chapter = (id: number) =>
  ({ id, novelId: 1, path: `/c/${id}`, name: `Chapter ${id}` } as ChapterInfo);

const deferred = <T>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(res => {
    resolve = res;
  });
  return { promise, resolve };
};

const saved = { html: '<p>x</p>', title: 't', createdAt: 'now' };

describe('useChapterTranslations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockKey = 'key:fx';
    mockTranslation = {
      sourceLang: 'ja',
      targetLang: 'en',
      showTranslation: false,
      glossaries: {},
    };
    jest.mocked(listTranslatedChapterIds).mockResolvedValue(new Set());
    jest.mocked(translateChapter).mockResolvedValue(saved);
    jest.mocked(deleteTranslation).mockResolvedValue();
  });

  it('hides the button until languages are set', () => {
    mockTranslation = undefined;
    const { result, rerender } = renderHook(() => useChapterTranslations());
    expect(result.current.getState(1)).toBeUndefined();

    mockTranslation = {
      sourceLang: 'ja',
      targetLang: '',
      showTranslation: false,
      glossaries: {},
    };
    rerender({});
    expect(result.current.getState(1)).toBeUndefined();
  });

  it('shows saved chapters after loading the folder', async () => {
    jest.mocked(listTranslatedChapterIds).mockResolvedValue(new Set([2]));
    const { result } = renderHook(() => useChapterTranslations());
    await waitFor(() => expect(result.current.getState(2)).toBe('saved'));
    expect(result.current.getState(3)).toBe('none');
    expect(listTranslatedChapterIds).toHaveBeenCalledWith(
      'plug',
      1,
      'ja',
      'en',
    );
  });

  it('translates queued chapters one at a time', async () => {
    const first = deferred<typeof saved>();
    jest
      .mocked(translateChapter)
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(saved);
    const { result } = renderHook(() => useChapterTranslations());

    act(() => {
      result.current.translate(chapter(1));
      result.current.translate(chapter(2));
    });
    expect(result.current.getState(1)).toBe('translating');
    expect(result.current.getState(2)).toBe('translating');
    expect(translateChapter).toHaveBeenCalledTimes(1);

    await act(async () => first.resolve(saved));
    await waitFor(() => expect(translateChapter).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.getState(2)).toBe('saved'));
    expect(jest.mocked(translateChapter).mock.calls[0][0]).toMatchObject({
      apiKey: 'key:fx',
      pluginId: 'plug',
      novelId: 1,
      sourceLang: 'ja',
      targetLang: 'en',
      force: false,
    });
  });

  it('ignores presses on a chapter that is queued or running', async () => {
    const first = deferred<typeof saved>();
    jest.mocked(translateChapter).mockReturnValueOnce(first.promise);
    const { result } = renderHook(() => useChapterTranslations());

    act(() => {
      result.current.translate(chapter(1));
      result.current.translate(chapter(1));
    });
    await act(async () => first.resolve(saved));
    await waitFor(() => expect(result.current.getState(1)).toBe('saved'));
    expect(translateChapter).toHaveBeenCalledTimes(1);
  });

  it('marks a chapter saved after success', async () => {
    const { result } = renderHook(() => useChapterTranslations());
    act(() => result.current.translate(chapter(1)));
    await waitFor(() => expect(result.current.getState(1)).toBe('saved'));
  });

  it('returns to none and shows the message on failure', async () => {
    jest
      .mocked(translateChapter)
      .mockRejectedValueOnce(new TranslationError('quota_exceeded'))
      .mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useChapterTranslations());

    act(() => result.current.translate(chapter(1)));
    await waitFor(() => expect(result.current.getState(1)).toBe('none'));
    expect(showToast).toHaveBeenLastCalledWith(
      'translation.errors.quotaExceeded',
    );

    act(() => result.current.translate(chapter(2)));
    await waitFor(() => expect(result.current.getState(2)).toBe('none'));
    expect(showToast).toHaveBeenLastCalledWith('translation.errors.unknown');
  });

  it('refreshes saved chapters when the screen regains focus', async () => {
    const { result } = renderHook(() => useChapterTranslations());
    await waitFor(() => expect(listTranslatedChapterIds).toHaveBeenCalled());
    expect(result.current.getState(5)).toBe('none');

    jest.mocked(listTranslatedChapterIds).mockResolvedValue(new Set([5]));
    act(() => mockFocusCallback?.());
    await waitFor(() => expect(result.current.getState(5)).toBe('saved'));
  });

  it('retranslate passes force', async () => {
    const { result } = renderHook(() => useChapterTranslations());
    act(() => result.current.retranslate(chapter(1)));
    await waitFor(() => expect(translateChapter).toHaveBeenCalled());
    expect(jest.mocked(translateChapter).mock.calls[0][0].force).toBe(true);
  });

  it('removes a saved translation', async () => {
    jest.mocked(listTranslatedChapterIds).mockResolvedValue(new Set([2]));
    const { result } = renderHook(() => useChapterTranslations());
    await waitFor(() => expect(result.current.getState(2)).toBe('saved'));

    act(() => result.current.remove(chapter(2)));
    await waitFor(() => expect(result.current.getState(2)).toBe('none'));
    expect(deleteTranslation).toHaveBeenCalledWith({
      pluginId: 'plug',
      novelId: 1,
      chapterId: 2,
      sourceLang: 'ja',
      targetLang: 'en',
    });
  });

  it('keeps the saved state for a chapter without a key', async () => {
    mockKey = undefined;
    jest.mocked(listTranslatedChapterIds).mockResolvedValue(new Set([2]));
    const { result } = renderHook(() => useChapterTranslations());
    await waitFor(() => expect(result.current.getState(2)).toBe('saved'));
    expect(result.current.getState(3)).toBeUndefined();
  });
});
