import { act, renderHook, waitFor } from '@testing-library/react-native';
import useChapter from '../useChapter';
import NativeFile from '@modules/native-file';
import NativeVolumeButtonListener from '@modules/native-volume-button-listener';
import { TranslationError } from '@services/translation/deeplClient';
import { translationErrorMessage } from '@services/translation/translationErrorMessage';
import type { NovelTranslationSettings } from '@hooks/persisted/useNovel/types';

const mockUseNovelActions = jest.fn();
const mockUseChapterGeneralSettings = jest.fn();
const mockUseLibrarySettings = jest.fn();
const mockUseAppSettings = jest.fn();
const mockUseTracker = jest.fn();
const mockUseTrackedNovel = jest.fn();
const mockUseFullscreenMode = jest.fn();

const mockGetDbChapter = jest.fn();
const mockGetChapterCount = jest.fn();
const mockGetNextChapter = jest.fn();
const mockGetPrevChapter = jest.fn();
const mockInsertChapters = jest.fn();
const mockInsertHistory = jest.fn();
const mockFetchChapter = jest.fn();
const mockFetchPage = jest.fn();
const mockSanitizeChapterText = jest.fn();
const mockParseChapterNumber = jest.fn();

const mockUseNovelValue = jest.fn();

const mockTranslateChapter = jest.fn();
const mockReadTranslation = jest.fn();
const mockShowToast = jest.fn();
const mockSetTranslation = jest.fn();
let mockTranslation: NovelTranslationSettings | undefined;
let mockApiKey: string | undefined;

jest.mock('@services/translation/translateChapter', () => ({
  translateChapter: (...args: unknown[]) => mockTranslateChapter(...args),
}));

jest.mock('@services/translation/translationStorage', () => ({
  readTranslation: (...args: unknown[]) => mockReadTranslation(...args),
}));

jest.mock('@hooks/persisted/useDeepLKey', () => ({
  getDeepLApiKey: () => mockApiKey,
  useDeepLKey: () => ({ apiKey: mockApiKey }),
}));

jest.mock('@hooks/persisted/useNovelSettings', () => ({
  useNovelSettings: () => ({
    translation: mockTranslation,
    setTranslation: mockSetTranslation,
  }),
}));

jest.mock('@utils/showToast', () => ({
  showToast: (...args: unknown[]) => mockShowToast(...args),
}));

jest.mock('@screens/novel/NovelContext', () => ({
  useNovelActions: () => mockUseNovelActions(),
  useNovelValue: (key: string) => mockUseNovelValue(key),
}));

jest.mock('@hooks/persisted', () => ({
  useChapterGeneralSettings: () => mockUseChapterGeneralSettings(),
  useLibrarySettings: () => mockUseLibrarySettings(),
  useAppSettings: () => mockUseAppSettings(),
  useTracker: () => mockUseTracker(),
  useTrackedNovel: (...args: unknown[]) => mockUseTrackedNovel(...args),
}));

jest.mock('@hooks', () => ({
  useFullscreenMode: () => mockUseFullscreenMode(),
}));

jest.mock('@database/queries/ChapterQueries', () => ({
  getChapter: (...args: unknown[]) => mockGetDbChapter(...args),
  getChapterCount: (...args: unknown[]) => mockGetChapterCount(...args),
  getNextChapter: (...args: unknown[]) => mockGetNextChapter(...args),
  getPrevChapter: (...args: unknown[]) => mockGetPrevChapter(...args),
  insertChapters: (...args: unknown[]) => mockInsertChapters(...args),
}));

jest.mock('@database/queries/HistoryQueries', () => ({
  insertHistory: (...args: unknown[]) => mockInsertHistory(...args),
}));

jest.mock('@services/plugin/fetch', () => ({
  fetchChapter: (...args: unknown[]) => mockFetchChapter(...args),
  fetchPage: (...args: unknown[]) => mockFetchPage(...args),
}));

jest.mock('../../utils/sanitizeChapterText', () => ({
  sanitizeChapterText: (...args: unknown[]) => mockSanitizeChapterText(...args),
}));

jest.mock('@utils/parseChapterNumber', () => ({
  parseChapterNumber: (...args: unknown[]) => mockParseChapterNumber(...args),
}));

jest.mock('expo-speech', () => ({
  stop: jest.fn(),
}));

const makeChapter = (id: number, page = '1') => ({
  id,
  novelId: 7,
  name: `Chapter ${id}`,
  path: `/chapter/${id}`,
  page,
  position: id,
  unread: true,
  isDownloaded: false,
  bookmark: false,
  progress: 0,
  releaseTime: '2026-01-01',
  updatedTime: '2026-01-01',
  readTime: '2026-01-01',
  timeSpent: 0,
});

const makeNovel = () => ({
  id: 7,
  pluginId: 'plugin.reader',
  path: '/novel/test',
  name: 'Novel Test',
  totalPages: 3,
  inLibrary: true,
});

const createDeferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
};

const createStore = (
  cacheSeed: Record<number, string | Promise<string>> = {},
) => {
  const cache = new Map<number, string | Promise<string>>(
    Object.entries(cacheSeed).map(([k, v]) => [Number(k), v]),
  );
  const chapterTextCache = {
    read: jest.fn((chapterId: number) => cache.get(chapterId)),
    write: jest.fn((chapterId: number, value: string | Promise<string>) => {
      cache.set(chapterId, value);
    }),
    remove: jest.fn((chapterId: number) => {
      cache.delete(chapterId);
    }),
    clear: jest.fn(() => cache.clear()),
  };
  const state = {
    markChapterRead: jest.fn(),
    updateChapterProgress: jest.fn(),
    chapterTextCache,
    setLastRead: jest.fn(),
    increaseTimeSpent: jest.fn(),
  };

  return {
    getState: () => state,
    subscribe: jest.fn(() => () => {}),
    state,
    chapterTextCache,
  };
};

describe('useChapter', () => {
  const initialChapter = makeChapter(1, '1');
  const nextChapter = makeChapter(2, '1');
  const novel = makeNovel();

  /**
   * The hook keeps `hidden` separate from the rest so the reader chrome can
   * toggle without invalidating the chapter context; flattening both keeps the
   * assertions below focused on behaviour.
   */
  const useFlatChapter = (chapter: ReturnType<typeof makeChapter>) => {
    const { hidden, chapterContext } = useChapter(
      { current: null },
      chapter,
      novel,
    );

    return { hidden, ...chapterContext };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (NativeFile.exists as jest.Mock).mockReturnValue(false);
    // The native module rejects when the chapter is not downloaded.
    (NativeFile.readFile as jest.Mock).mockRejectedValue(
      new Error('File not found'),
    );

    mockUseChapterGeneralSettings.mockReturnValue({
      autoScroll: false,
      autoScrollInterval: 1,
      autoScrollOffset: 100,
      useVolumeButtons: false,
      volumeButtonsOffset: 100,
      pageReader: false,
      pageReaderInvertVolumeButtons: false,
      pageReaderDisableAnimation: false,
    });
    mockUseLibrarySettings.mockReturnValue({ incognitoMode: false });
    mockUseAppSettings.mockReturnValue({
      timeTrackingEnabled: true,
      inactivityTimeoutMs: 60000,
    });
    mockUseTracker.mockReturnValue({ tracker: { id: 'tracker' } });
    mockUseTrackedNovel.mockReturnValue({
      trackedNovel: { progress: 1 },
      updateAllTrackedNovels: jest.fn(),
    });
    mockUseFullscreenMode.mockReturnValue({
      setImmersiveMode: jest.fn(),
      showStatusAndNavBar: jest.fn(),
    });

    mockGetDbChapter.mockResolvedValue(initialChapter);
    mockGetChapterCount.mockResolvedValue(1);
    mockGetNextChapter.mockResolvedValue(undefined);
    mockGetPrevChapter.mockResolvedValue(undefined);
    mockInsertChapters.mockResolvedValue(undefined);
    mockInsertHistory.mockResolvedValue(undefined);
    mockFetchChapter.mockResolvedValue('chapter body');
    mockFetchPage.mockResolvedValue({ chapters: [] });
    mockSanitizeChapterText.mockImplementation(
      (
        _pluginId: string,
        _novelName: string,
        _chapterName: string,
        text: string,
      ) => `SANITIZED:${text}`,
    );
    mockParseChapterNumber.mockReturnValue(5);

    mockTranslation = undefined;
    mockApiKey = undefined;
    mockTranslateChapter.mockReset();
    mockReadTranslation.mockReset();
    mockReadTranslation.mockResolvedValue(undefined);
    mockSetTranslation.mockImplementation(
      (next: Partial<NovelTranslationSettings>) => {
        mockTranslation = { ...mockTranslation!, ...next };
      },
    );
  });

  it('uses chapterTextCache on initial load and avoids duplicate fetch for cached chapter text', async () => {
    const store = createStore({ [initialChapter.id]: 'cached chapter body' });
    mockUseNovelActions.mockReturnValue(store.state);

    const { result } = renderHook(() => useFlatChapter(initialChapter));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockFetchChapter).not.toHaveBeenCalled();
    // Cached entries are already sanitized, so they are rendered as they are.
    expect(result.current.chapterText).toBe('cached chapter body');
    expect(mockSanitizeChapterText).not.toHaveBeenCalled();
    expect(store.chapterTextCache.write).not.toHaveBeenCalledWith(
      initialChapter.id,
      expect.anything(),
    );
  });

  it('renders a downloaded chapter from storage without touching the network', async () => {
    const store = createStore();
    mockUseNovelActions.mockReturnValue(store.state);
    (NativeFile.readFile as jest.Mock).mockResolvedValue('downloaded body');

    const { result } = renderHook(() => useFlatChapter(initialChapter));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.chapterText).toBe('SANITIZED:downloaded body');
    expect(mockFetchChapter).not.toHaveBeenCalled();
    // A single native call doubles as the existence check.
    expect(NativeFile.readFile).toHaveBeenCalledTimes(1);
    expect(NativeFile.exists).not.toHaveBeenCalled();
  });

  it('renders the chapter before its adjacent chapters are resolved', async () => {
    const store = createStore();
    mockUseNovelActions.mockReturnValue(store.state);
    (NativeFile.readFile as jest.Mock).mockResolvedValue('downloaded body');

    const deferredNextChapter = createDeferred<unknown>();
    mockGetNextChapter.mockReturnValue(deferredNextChapter.promise);

    const { result } = renderHook(() => useFlatChapter(initialChapter));

    // The neighbouring chapter lookups must not gate the first render.
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.chapterText).toBe('SANITIZED:downloaded body');
    expect(result.current.nextChapter).toBeUndefined();

    await act(async () => {
      deferredNextChapter.resolve(nextChapter);
      await deferredNextChapter.promise;
    });

    await waitFor(() =>
      expect(result.current.nextChapter).toEqual(nextChapter),
    );
  });

  it('hydrates the initial chapter from the database before rendering reader progress', async () => {
    const store = createStore({ [initialChapter.id]: 'cached chapter body' });
    const hydratedChapter = { ...initialChapter, progress: 56 };
    mockUseNovelActions.mockReturnValue(store.state);
    mockGetDbChapter.mockResolvedValue(hydratedChapter);

    const { result } = renderHook(() => useFlatChapter(initialChapter));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.chapter.progress).toBe(56);
  });

  it('uses database progress as the source of truth on initial open', async () => {
    const routeChapter = { ...initialChapter, progress: 72 };
    const dbChapter = { ...initialChapter, progress: 12 };
    const store = createStore({ [initialChapter.id]: 'cached chapter body' });
    mockUseNovelActions.mockReturnValue(store.state);
    mockGetDbChapter.mockResolvedValue(dbChapter);

    const { result } = renderHook(() => useFlatChapter(routeChapter));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.chapter.progress).toBe(12);
  });

  it('updates chapter progress, caps at 100, and marks chapter read/tracker progress near completion', async () => {
    const store = createStore();
    const updateAllTrackedNovels = jest.fn();
    mockUseTrackedNovel.mockReturnValue({
      trackedNovel: { progress: 2 },
      updateAllTrackedNovels,
    });
    mockUseNovelActions.mockReturnValue(store.state);

    const { result } = renderHook(() => useFlatChapter(initialChapter));

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.saveProgress(40);
      result.current.saveProgress(130);
    });

    expect(store.state.updateChapterProgress).toHaveBeenNthCalledWith(
      1,
      initialChapter.id,
      40,
    );
    expect(store.state.updateChapterProgress).toHaveBeenNthCalledWith(
      2,
      initialChapter.id,
      100,
    );
    expect(store.state.markChapterRead).toHaveBeenCalledTimes(1);
    expect(store.state.markChapterRead).toHaveBeenCalledWith(initialChapter.id);
    expect(mockParseChapterNumber).toHaveBeenCalledWith(
      novel.name,
      initialChapter.name,
    );
    expect(updateAllTrackedNovels).toHaveBeenCalledWith({ progress: 5 });
  });

  it('sets error and drops the failed load from the cache so a retry refetches', async () => {
    const store = createStore();
    mockUseNovelActions.mockReturnValue(store.state);
    mockFetchChapter.mockRejectedValueOnce(new Error('network failed'));

    const { result } = renderHook(() => useFlatChapter(initialChapter));

    await waitFor(() => expect(result.current.error).toBe('network failed'));
    expect(result.current.loading).toBe(false);
    expect(result.current.chapterText).toBe('');
    expect(store.chapterTextCache.read(initialChapter.id)).toBeUndefined();

    mockFetchChapter.mockResolvedValue('recovered body');
    await act(async () => {
      result.current.refetch();
    });

    await waitFor(() =>
      expect(result.current.chapterText).toBe('SANITIZED:recovered body'),
    );
  });

  it('drops an empty chapter from the cache so a refresh refetches', async () => {
    const store = createStore();
    mockUseNovelActions.mockReturnValue(store.state);
    mockFetchChapter.mockResolvedValueOnce('   ');

    const { result } = renderHook(() => useFlatChapter(initialChapter));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.chapterText).toBe('SANITIZED:   ');
    expect(store.chapterTextCache.read(initialChapter.id)).toBeUndefined();

    mockFetchChapter.mockResolvedValue('recovered body');
    await act(async () => {
      result.current.refetch();
    });

    await waitFor(() =>
      expect(result.current.chapterText).toBe('SANITIZED:recovered body'),
    );
    expect(mockFetchChapter).toHaveBeenCalledTimes(2);
  });

  it('reuses prefetched promise cache to avoid duplicate concurrent fetches for same chapter', async () => {
    const store = createStore();
    mockUseNovelActions.mockReturnValue(store.state);

    const deferredNext = createDeferred<string>();

    mockGetNextChapter.mockImplementation(
      async (_novelId: number, position: number) =>
        position === initialChapter.position ? nextChapter : undefined,
    );
    mockFetchChapter.mockImplementation(
      async (_pluginId: string, path: string) => {
        if (path === nextChapter.path) {
          return deferredNext.promise;
        }

        return 'initial body';
      },
    );

    const { result } = renderHook(() => useFlatChapter(initialChapter));

    await waitFor(() => expect(result.current.loading).toBe(false));

    // The next chapter is prefetched once the current one is on screen.
    await waitFor(() =>
      expect(
        mockFetchChapter.mock.calls.filter(
          ([, path]) => path === nextChapter.path,
        ),
      ).toHaveLength(1),
    );

    const navPromise = result.current.getChapter(nextChapter);

    expect(
      mockFetchChapter.mock.calls.filter(
        ([, path]) => path === nextChapter.path,
      ),
    ).toHaveLength(1);

    await act(async () => {
      deferredNext.resolve('next body');
      await navPromise;
    });

    expect(result.current.chapter.id).toBe(nextChapter.id);
    expect(result.current.chapterText).toBe('SANITIZED:next body');
  });

  it('injects scripts supporting paged and normal modes when volume buttons are pressed', async () => {
    const store = createStore();
    mockUseNovelActions.mockReturnValue(store.state);
    const mockInjectJavaScript = jest.fn();

    const { result } = renderHook(() =>
      useChapter(
        { current: { injectJavaScript: mockInjectJavaScript } as any },
        initialChapter,
        novel,
      ),
    );

    await waitFor(() =>
      expect(result.current.chapterContext.loading).toBe(false),
    );

    const volumeUpCall = (
      NativeVolumeButtonListener.addListener as jest.Mock
    ).mock.calls.find(([event]) => event === 'VolumeUp');
    const volumeDownCall = (
      NativeVolumeButtonListener.addListener as jest.Mock
    ).mock.calls.find(([event]) => event === 'VolumeDown');

    expect(volumeUpCall).toBeDefined();
    expect(volumeDownCall).toBeDefined();

    // Trigger VolumeUp callback
    volumeUpCall[1]();
    expect(mockInjectJavaScript).toHaveBeenCalledWith(
      expect.stringContaining(
        'window.pageReader.movePage((window.pageReader.page?.val ?? 0) - 1)',
      ),
    );
    expect(mockInjectJavaScript).toHaveBeenCalledWith(
      expect.stringContaining('window.scrollBy'),
    );

    // Trigger VolumeDown callback
    volumeDownCall[1]();
    expect(mockInjectJavaScript).toHaveBeenCalledWith(
      expect.stringContaining(
        'window.pageReader.movePage((window.pageReader.page?.val ?? 0) + 1)',
      ),
    );
    expect(mockInjectJavaScript).toHaveBeenCalledWith(
      expect.stringContaining('window.scrollBy'),
    );
  });

  it('inverts volume button directions in paged mode when pageReaderInvertVolumeButtons is enabled', async () => {
    const store = createStore();
    mockUseNovelActions.mockReturnValue(store.state);
    mockUseChapterGeneralSettings.mockReturnValue({
      autoScroll: false,
      autoScrollInterval: 1,
      autoScrollOffset: 100,
      useVolumeButtons: false,
      volumeButtonsOffset: 100,
      pageReader: true,
      pageReaderInvertVolumeButtons: true,
      pageReaderDisableAnimation: false,
    });
    const mockInjectJavaScript = jest.fn();

    const { result } = renderHook(() =>
      useChapter(
        { current: { injectJavaScript: mockInjectJavaScript } as any },
        initialChapter,
        novel,
      ),
    );

    await waitFor(() =>
      expect(result.current.chapterContext.loading).toBe(false),
    );

    const volumeUpCall = (
      NativeVolumeButtonListener.addListener as jest.Mock
    ).mock.calls.find(([event]) => event === 'VolumeUp');
    const volumeDownCall = (
      NativeVolumeButtonListener.addListener as jest.Mock
    ).mock.calls.find(([event]) => event === 'VolumeDown');

    expect(volumeUpCall).toBeDefined();
    expect(volumeDownCall).toBeDefined();

    // VolumeUp callback should move +1 (forward) when inverted
    volumeUpCall[1]();
    expect(mockInjectJavaScript).toHaveBeenCalledWith(
      expect.stringContaining(
        'window.pageReader.movePage((window.pageReader.page?.val ?? 0) + 1)',
      ),
    );

    // VolumeDown callback should move -1 (backward) when inverted
    volumeDownCall[1]();
    expect(mockInjectJavaScript).toHaveBeenCalledWith(
      expect.stringContaining(
        'window.pageReader.movePage((window.pageReader.page?.val ?? 0) - 1)',
      ),
    );
  });

  describe('translation', () => {
    const translationSettings = (
      overrides: Partial<NovelTranslationSettings> = {},
    ): NovelTranslationSettings => ({
      sourceLang: 'zh',
      targetLang: 'ru',
      showTranslation: true,
      glossaries: {},
      ...overrides,
    });
    const savedTranslation = (id = 1) => ({
      html: `<p>translated ${id}</p>`,
      title: `Translated ${id}`,
      createdAt: '2026-11-07T00:00:00.000Z',
    });

    const renderLoaded = async () => {
      const store = createStore();
      mockUseNovelActions.mockReturnValue(store.state);
      const view = renderHook(() => useFlatChapter(initialChapter));
      await waitFor(() => expect(view.result.current.loading).toBe(false));
      return { ...view, store };
    };

    it('shows the original when translation is not configured', async () => {
      mockApiKey = 'key';
      mockTranslation = translationSettings({ targetLang: '' });

      const { result } = await renderLoaded();

      expect(result.current.chapterText).toBe('SANITIZED:chapter body');
      expect(result.current.showingTranslation).toBe(false);
      expect(mockReadTranslation).not.toHaveBeenCalled();
      expect(mockTranslateChapter).not.toHaveBeenCalled();
      expect(mockShowToast).not.toHaveBeenCalled();
    });

    it('shows a saved translation without a key and without calling DeepL', async () => {
      mockTranslation = translationSettings();
      mockReadTranslation.mockResolvedValue(savedTranslation());

      const { result } = await renderLoaded();

      expect(mockReadTranslation).toHaveBeenCalledWith({
        pluginId: novel.pluginId,
        novelId: initialChapter.novelId,
        chapterId: initialChapter.id,
        sourceLang: 'zh',
        targetLang: 'ru',
      });
      expect(result.current.chapterText).toBe('SANITIZED:<p>translated 1</p>');
      expect(result.current.translatedTitle).toBe('Translated 1');
      expect(result.current.showingTranslation).toBe(true);
      expect(result.current.translationAvailable).toBe(true);
      expect(mockTranslateChapter).not.toHaveBeenCalled();
    });

    it('shows the original silently without a key or a saved translation', async () => {
      mockTranslation = translationSettings();

      const { result } = await renderLoaded();

      expect(result.current.chapterText).toBe('SANITIZED:chapter body');
      expect(result.current.showingTranslation).toBe(false);
      expect(mockTranslateChapter).not.toHaveBeenCalled();
      expect(mockShowToast).not.toHaveBeenCalled();
    });

    it('offers no button without a key, a saved translation or the mode', async () => {
      mockTranslation = translationSettings({ showTranslation: false });

      const { result } = await renderLoaded();

      expect(result.current.translationAvailable).toBe(false);
    });

    it('keeps the button while the mode is on after the key is removed', async () => {
      mockTranslation = translationSettings();

      const { result, rerender } = await renderLoaded();

      expect(result.current.translationAvailable).toBe(true);

      await act(async () => {
        result.current.toggleTranslation();
      });
      await waitFor(() => expect(mockTranslation?.showTranslation).toBe(false));
      rerender({});

      expect(result.current.translationAvailable).toBe(false);
      expect(mockTranslateChapter).not.toHaveBeenCalled();
    });

    it('opens a saved translation when the original cannot be fetched', async () => {
      mockTranslation = translationSettings();
      mockReadTranslation.mockResolvedValue(savedTranslation());
      mockFetchChapter.mockRejectedValue(new Error('offline'));

      const { result } = await renderLoaded();

      expect(result.current.error).toBeUndefined();
      expect(result.current.showingTranslation).toBe(true);
      expect(result.current.chapterText).toBe('SANITIZED:<p>translated 1</p>');
      expect(mockFetchChapter).not.toHaveBeenCalled();
    });

    it('loads the original on demand after a saved translation opened without it', async () => {
      mockTranslation = translationSettings();
      mockReadTranslation.mockResolvedValue(savedTranslation());

      const { result } = await renderLoaded();
      expect(mockFetchChapter).not.toHaveBeenCalled();

      await act(async () => {
        result.current.toggleTranslation();
      });

      await waitFor(() =>
        expect(result.current.chapterText).toBe('SANITIZED:chapter body'),
      );
      expect(result.current.error).toBeUndefined();
    });

    it('toggles a saved translation both ways without a key', async () => {
      mockTranslation = translationSettings({ showTranslation: false });
      mockReadTranslation.mockResolvedValue(savedTranslation());

      const { result, rerender } = await renderLoaded();
      expect(result.current.translationAvailable).toBe(true);

      await act(async () => {
        result.current.toggleTranslation();
      });
      await waitFor(() => expect(result.current.showingTranslation).toBe(true));
      rerender({});
      expect(result.current.chapterText).toBe('SANITIZED:<p>translated 1</p>');
      expect(mockTranslation?.showTranslation).toBe(true);

      await act(async () => {
        result.current.toggleTranslation();
      });
      await waitFor(() =>
        expect(result.current.showingTranslation).toBe(false),
      );
      rerender({});

      expect(result.current.chapterText).toBe('SANITIZED:chapter body');
      expect(mockTranslation?.showTranslation).toBe(false);
      expect(result.current.translationAvailable).toBe(true);
      expect(mockTranslateChapter).not.toHaveBeenCalled();
    });

    it('offers a saved translation without a key while the mode is off', async () => {
      mockTranslation = translationSettings({ showTranslation: false });
      mockReadTranslation.mockResolvedValue(savedTranslation());

      const { result } = await renderLoaded();

      expect(result.current.chapterText).toBe('SANITIZED:chapter body');
      expect(result.current.showingTranslation).toBe(false);
      expect(result.current.translationAvailable).toBe(true);
    });

    it('translates the opened chapter when the mode is on', async () => {
      mockApiKey = 'key';
      mockTranslation = translationSettings({
        glossaryId: 'glossary-1',
        glossaries: { 'zh-ru': { entryCount: 3 } },
      });
      mockTranslateChapter.mockResolvedValue(savedTranslation());

      const { result } = await renderLoaded();

      expect(mockTranslateChapter).toHaveBeenCalledTimes(1);
      expect(mockTranslateChapter).toHaveBeenCalledWith({
        apiKey: 'key',
        pluginId: novel.pluginId,
        novelId: initialChapter.novelId,
        chapter: initialChapter,
        sourceLang: 'zh',
        targetLang: 'ru',
        glossaryId: 'glossary-1',
      });
      expect(result.current.chapterText).toBe('SANITIZED:<p>translated 1</p>');
      expect(result.current.translatedTitle).toBe('Translated 1');
      expect(result.current.showingTranslation).toBe(true);
      expect(result.current.translating).toBe(false);
    });

    it('falls back to the original and shows the error message on failure', async () => {
      mockApiKey = 'key';
      mockTranslation = translationSettings();
      mockTranslateChapter.mockRejectedValue(
        new TranslationError('quota_exceeded'),
      );

      const { result } = await renderLoaded();

      expect(mockShowToast).toHaveBeenCalledWith(
        translationErrorMessage('quota_exceeded'),
      );
      expect(result.current.chapterText).toBe('SANITIZED:chapter body');
      expect(result.current.showingTranslation).toBe(false);
      expect(result.current.translatedTitle).toBeUndefined();
      expect(result.current.translating).toBe(false);
      expect(result.current.error).toBeUndefined();
    });

    it('does not cache an error as a translation', async () => {
      mockApiKey = 'key';
      mockTranslation = translationSettings();
      mockTranslateChapter
        .mockRejectedValueOnce(new TranslationError('network'))
        .mockResolvedValueOnce(savedTranslation());

      const { result } = await renderLoaded();
      expect(result.current.showingTranslation).toBe(false);

      await act(async () => {
        result.current.toggleTranslation();
      });

      await waitFor(() => expect(result.current.showingTranslation).toBe(true));
      expect(mockTranslateChapter).toHaveBeenCalledTimes(2);
      expect(result.current.chapterText).toBe('SANITIZED:<p>translated 1</p>');
    });

    it('keeps the mode when opening a chapter fails, and drops it when a press fails', async () => {
      mockApiKey = 'key';
      mockTranslation = translationSettings();
      mockTranslateChapter.mockRejectedValue(new TranslationError('network'));

      const { result, rerender } = await renderLoaded();
      expect(mockTranslation?.showTranslation).toBe(true);
      expect(mockSetTranslation).not.toHaveBeenCalled();

      await act(async () => {
        result.current.toggleTranslation();
      });
      await waitFor(() =>
        expect(mockTranslateChapter).toHaveBeenCalledTimes(2),
      );
      await waitFor(() => expect(mockTranslation?.showTranslation).toBe(false));
      rerender({});

      await act(async () => {
        result.current.toggleTranslation();
      });
      await waitFor(() =>
        expect(mockTranslateChapter).toHaveBeenCalledTimes(3),
      );
      await waitFor(() => expect(mockTranslation?.showTranslation).toBe(false));
      expect(mockSetTranslation).toHaveBeenLastCalledWith({
        showTranslation: false,
      });
      expect(result.current.showingTranslation).toBe(false);
    });

    it('does not drop the mode for a pressed translation the reader left', async () => {
      mockApiKey = 'key';
      mockTranslation = translationSettings({ showTranslation: false });
      const deferred = createDeferred<never>();
      mockTranslateChapter
        .mockReturnValueOnce(deferred.promise)
        .mockResolvedValueOnce(savedTranslation(2));

      const { result } = await renderLoaded();

      act(() => {
        result.current.toggleTranslation();
      });
      await waitFor(() => expect(result.current.translating).toBe(true));

      await act(async () => {
        await result.current.getChapter(nextChapter);
      });
      await act(async () => {
        deferred.reject(new TranslationError('network'));
      });

      expect(mockTranslation?.showTranslation).toBe(true);
      expect(result.current.showingTranslation).toBe(true);
    });

    it('does not retry a failed translation on re-render', async () => {
      mockApiKey = 'key';
      mockTranslation = translationSettings();
      mockTranslateChapter.mockRejectedValue(new TranslationError('network'));

      const { rerender } = await renderLoaded();

      mockTranslation = translationSettings({ glossaries: {} });
      rerender({});
      await act(async () => {
        await Promise.resolve();
      });

      expect(mockTranslateChapter).toHaveBeenCalledTimes(1);
    });

    it('never translates the prefetched next chapter', async () => {
      mockApiKey = 'key';
      mockTranslation = translationSettings();
      mockTranslateChapter.mockResolvedValue(savedTranslation());
      mockGetNextChapter.mockImplementation(
        async (_novelId: number, position: number) =>
          position === initialChapter.position ? nextChapter : undefined,
      );

      await renderLoaded();

      await waitFor(() =>
        expect(mockFetchChapter).toHaveBeenCalledWith(
          novel.pluginId,
          nextChapter.path,
        ),
      );
      expect(mockTranslateChapter).toHaveBeenCalledTimes(1);
      expect(mockTranslateChapter.mock.calls[0][0].chapter.id).toBe(
        initialChapter.id,
      );
      expect(mockReadTranslation).not.toHaveBeenCalledWith(
        expect.objectContaining({ chapterId: nextChapter.id }),
      );
    });

    it('keeps the original in chapterTextCache while a translation is shown', async () => {
      mockApiKey = 'key';
      mockTranslation = translationSettings();
      mockTranslateChapter.mockResolvedValue(savedTranslation());

      const { result, store } = await renderLoaded();

      expect(result.current.showingTranslation).toBe(true);
      expect(store.chapterTextCache.write).toHaveBeenCalledTimes(1);
      await expect(
        store.chapterTextCache.read(initialChapter.id),
      ).resolves.toBe('SANITIZED:chapter body');
    });

    it('toggles back to the original without a DeepL call', async () => {
      mockApiKey = 'key';
      mockTranslation = translationSettings();
      mockTranslateChapter.mockResolvedValue(savedTranslation());

      const { result } = await renderLoaded();
      expect(result.current.showingTranslation).toBe(true);

      await act(async () => {
        result.current.toggleTranslation();
      });

      await waitFor(() =>
        expect(result.current.showingTranslation).toBe(false),
      );
      expect(result.current.chapterText).toBe('SANITIZED:chapter body');
      expect(result.current.translatedTitle).toBeUndefined();
      expect(mockSetTranslation).toHaveBeenCalledWith({
        showTranslation: false,
      });
      expect(mockTranslateChapter).toHaveBeenCalledTimes(1);
    });

    it('keeps the old text on screen while a toggle translates', async () => {
      mockApiKey = 'key';
      mockTranslation = translationSettings({ showTranslation: false });
      const deferred = createDeferred<ReturnType<typeof savedTranslation>>();
      mockTranslateChapter.mockReturnValue(deferred.promise);

      const { result } = await renderLoaded();

      act(() => {
        result.current.toggleTranslation();
      });

      await waitFor(() => expect(result.current.translating).toBe(true));
      expect(result.current.loading).toBe(false);
      expect(result.current.chapterText).toBe('SANITIZED:chapter body');

      await act(async () => {
        deferred.resolve(savedTranslation());
      });

      await waitFor(() => expect(result.current.showingTranslation).toBe(true));
      expect(result.current.translating).toBe(false);
      expect(result.current.chapterText).toBe('SANITIZED:<p>translated 1</p>');
    });

    it('shows the loading screen while a newly opened chapter is translated', async () => {
      mockApiKey = 'key';
      mockTranslation = translationSettings();
      const deferred = createDeferred<ReturnType<typeof savedTranslation>>();
      mockTranslateChapter
        .mockResolvedValueOnce(savedTranslation())
        .mockReturnValueOnce(deferred.promise);

      const { result } = await renderLoaded();

      act(() => {
        void result.current.getChapter(nextChapter);
      });

      await waitFor(() => expect(result.current.loading).toBe(true));
      expect(result.current.translating).toBe(true);

      await act(async () => {
        deferred.resolve(savedTranslation(2));
      });

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.chapter.id).toBe(nextChapter.id);
      expect(result.current.chapterText).toBe('SANITIZED:<p>translated 2</p>');
    });

    it('stores the mode for the novel so the next chapter opens the same way', async () => {
      mockApiKey = 'key';
      mockTranslation = translationSettings({ showTranslation: false });
      mockTranslateChapter.mockImplementation(async ({ chapter }) =>
        savedTranslation(chapter.id),
      );

      const { result, rerender } = await renderLoaded();

      await act(async () => {
        result.current.toggleTranslation();
      });
      await waitFor(() => expect(result.current.showingTranslation).toBe(true));
      expect(mockSetTranslation).toHaveBeenCalledWith({
        showTranslation: true,
      });
      rerender({});

      await act(async () => {
        await result.current.getChapter(nextChapter);
      });

      expect(result.current.chapter.id).toBe(nextChapter.id);
      expect(result.current.chapterText).toBe('SANITIZED:<p>translated 2</p>');
      expect(result.current.translatedTitle).toBe('Translated 2');
    });

    it('ignores a finished translation after the reader moved on', async () => {
      mockApiKey = 'key';
      mockTranslation = translationSettings();
      const deferred = createDeferred<ReturnType<typeof savedTranslation>>();
      mockTranslateChapter.mockReturnValue(deferred.promise);
      mockReadTranslation.mockImplementation(async ({ chapterId }) =>
        chapterId === nextChapter.id ? savedTranslation(2) : undefined,
      );
      const store = createStore();
      mockUseNovelActions.mockReturnValue(store.state);

      const { result } = renderHook(() => useFlatChapter(initialChapter));
      await waitFor(() => expect(result.current.translating).toBe(true));

      await act(async () => {
        await result.current.getChapter(nextChapter);
      });
      expect(result.current.chapterText).toBe('SANITIZED:<p>translated 2</p>');
      expect(result.current.translating).toBe(false);

      await act(async () => {
        deferred.resolve(savedTranslation(1));
      });

      expect(result.current.chapter.id).toBe(nextChapter.id);
      expect(result.current.chapterText).toBe('SANITIZED:<p>translated 2</p>');
      expect(result.current.translatedTitle).toBe('Translated 2');
    });

    it('does not start a translation for a chapter the reader already left', async () => {
      mockApiKey = 'key';
      mockTranslation = translationSettings();
      const deferredRead = createDeferred<undefined>();
      mockReadTranslation.mockImplementation(({ chapterId }) =>
        chapterId === initialChapter.id
          ? deferredRead.promise
          : Promise.resolve(savedTranslation(2)),
      );
      const store = createStore();
      mockUseNovelActions.mockReturnValue(store.state);

      const { result } = renderHook(() => useFlatChapter(initialChapter));
      await waitFor(() => expect(mockReadTranslation).toHaveBeenCalled());

      await act(async () => {
        await result.current.getChapter(nextChapter);
      });
      await act(async () => {
        deferredRead.resolve(undefined);
      });

      expect(mockTranslateChapter).not.toHaveBeenCalled();
      expect(mockFetchChapter).not.toHaveBeenCalledWith(
        novel.pluginId,
        initialChapter.path,
      );
      expect(result.current.chapter.id).toBe(nextChapter.id);
    });

    it('stays silent about a failed translation after the reader moved on', async () => {
      mockApiKey = 'key';
      mockTranslation = translationSettings();
      const deferred = createDeferred<never>();
      mockTranslateChapter.mockReturnValueOnce(deferred.promise);
      mockTranslateChapter.mockResolvedValueOnce(savedTranslation(2));
      const store = createStore();
      mockUseNovelActions.mockReturnValue(store.state);

      const { result } = renderHook(() => useFlatChapter(initialChapter));
      await waitFor(() => expect(result.current.translating).toBe(true));

      await act(async () => {
        await result.current.getChapter(nextChapter);
      });
      await act(async () => {
        deferred.reject(new TranslationError('network'));
      });

      expect(mockShowToast).not.toHaveBeenCalled();
      expect(result.current.showingTranslation).toBe(true);
    });

    it('keeps the indicator on when a superseded translation finishes', async () => {
      mockApiKey = 'key';
      mockTranslation = translationSettings();
      const first = createDeferred<ReturnType<typeof savedTranslation>>();
      const second = createDeferred<ReturnType<typeof savedTranslation>>();
      mockTranslateChapter
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise);
      const store = createStore();
      mockUseNovelActions.mockReturnValue(store.state);

      const { result } = renderHook(() => useFlatChapter(initialChapter));
      await waitFor(() => expect(result.current.translating).toBe(true));

      act(() => {
        void result.current.getChapter(nextChapter);
      });
      await waitFor(() =>
        expect(mockTranslateChapter).toHaveBeenCalledTimes(2),
      );

      await act(async () => {
        first.resolve(savedTranslation(1));
      });
      expect(result.current.translating).toBe(true);

      await act(async () => {
        second.resolve(savedTranslation(2));
      });
      await waitFor(() => expect(result.current.translating).toBe(false));
      expect(result.current.chapter.id).toBe(nextChapter.id);
    });

    it('does not cancel a chapter change when toggled mid-load', async () => {
      mockApiKey = 'key';
      mockTranslation = translationSettings({ showTranslation: false });
      const deferredText = createDeferred<string>();
      mockFetchChapter.mockImplementation(
        async (_pluginId: string, path: string) =>
          path === nextChapter.path ? deferredText.promise : 'chapter body',
      );
      mockTranslateChapter.mockResolvedValue(savedTranslation(2));

      const { result } = await renderLoaded();

      act(() => {
        void result.current.getChapter(nextChapter);
      });
      act(() => {
        result.current.toggleTranslation();
      });
      await act(async () => {
        deferredText.resolve('next body');
      });

      await waitFor(() =>
        expect(result.current.chapter.id).toBe(nextChapter.id),
      );
      expect(result.current.showingTranslation).toBe(true);
    });

    it('makes at most one translation call when the button is tapped twice at once', async () => {
      mockApiKey = 'key';
      mockTranslation = translationSettings({ showTranslation: false });
      mockTranslateChapter.mockResolvedValue(savedTranslation());

      const { result } = await renderLoaded();

      await act(async () => {
        result.current.toggleTranslation();
        result.current.toggleTranslation();
      });

      await waitFor(() => expect(result.current.translating).toBe(false));
      expect(mockTranslateChapter.mock.calls.length).toBeLessThanOrEqual(1);
      expect(result.current.showingTranslation).toBe(false);
      expect(mockSetTranslation).toHaveBeenLastCalledWith({
        showTranslation: false,
      });
    });

    it('clears the translated title when the next chapter shows the original', async () => {
      mockTranslation = translationSettings();
      mockReadTranslation.mockImplementation(async ({ chapterId }) =>
        chapterId === initialChapter.id ? savedTranslation() : undefined,
      );

      const { result } = await renderLoaded();
      expect(result.current.translatedTitle).toBe('Translated 1');

      await act(async () => {
        await result.current.getChapter(nextChapter);
      });

      expect(result.current.chapter.id).toBe(nextChapter.id);
      expect(result.current.translatedTitle).toBeUndefined();
      expect(result.current.showingTranslation).toBe(false);
    });

    it('keeps getChapter stable when the translation settings change', async () => {
      mockApiKey = 'key';
      mockTranslation = translationSettings({ showTranslation: false });

      const { result, rerender } = await renderLoaded();
      const { getChapter, toggleTranslation, canAutoAdvance } = result.current;

      mockTranslation = translationSettings({ targetLang: 'en' });
      rerender({});

      expect(result.current.getChapter).toBe(getChapter);
      expect(result.current.toggleTranslation).toBe(toggleTranslation);
      expect(result.current.canAutoAdvance).toBe(canAutoAdvance);
    });

    it('stops on a missing glossary without spending quota on a retry', async () => {
      mockApiKey = 'key';
      mockTranslation = translationSettings({
        glossaryId: 'glossary-1',
        glossaries: { 'zh-ru': { entryCount: 3 } },
      });
      mockTranslateChapter.mockRejectedValue(
        new TranslationError('glossary_missing'),
      );

      const { result } = await renderLoaded();

      expect(mockTranslateChapter).toHaveBeenCalledTimes(1);
      expect(mockShowToast).toHaveBeenCalledWith(
        translationErrorMessage('glossary_missing'),
      );
      expect(result.current.chapterText).toBe('SANITIZED:chapter body');
    });

    describe('canAutoAdvance', () => {
      const renderWithNextChapter = async () => {
        mockGetNextChapter.mockResolvedValue(nextChapter);
        const view = await renderLoaded();
        await waitFor(() =>
          expect(view.result.current.nextChapter).toEqual(nextChapter),
        );
        return view;
      };

      it('blocks auto advance to an untranslated chapter in translation mode', async () => {
        mockApiKey = 'key';
        mockTranslation = translationSettings();
        mockTranslateChapter.mockResolvedValue(savedTranslation());

        const { result } = await renderWithNextChapter();
        mockTranslateChapter.mockClear();

        await expect(result.current.canAutoAdvance()).resolves.toBe(false);
        expect(mockReadTranslation).toHaveBeenLastCalledWith(
          expect.objectContaining({ chapterId: nextChapter.id }),
        );
        expect(mockTranslateChapter).not.toHaveBeenCalled();
      });

      it('allows auto advance to a saved translation', async () => {
        mockTranslation = translationSettings();
        mockReadTranslation.mockResolvedValue(savedTranslation());

        const { result } = await renderWithNextChapter();

        await expect(result.current.canAutoAdvance()).resolves.toBe(true);
        expect(mockTranslateChapter).not.toHaveBeenCalled();
      });

      it('allows auto advance when the mode is off', async () => {
        mockApiKey = 'key';
        mockTranslation = translationSettings({ showTranslation: false });

        const { result } = await renderWithNextChapter();

        await expect(result.current.canAutoAdvance()).resolves.toBe(true);
        expect(mockReadTranslation).not.toHaveBeenCalled();
      });

      it('allows auto advance when there is no next chapter', async () => {
        mockApiKey = 'key';
        mockTranslation = translationSettings();
        mockTranslateChapter.mockResolvedValue(savedTranslation());

        const { result } = await renderLoaded();

        await expect(result.current.canAutoAdvance()).resolves.toBe(true);
      });
    });
  });
});
