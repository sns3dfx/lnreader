import { act, render } from '@test-utils';

import WebViewReader from '../WebViewReader';

const mockUseChapterContext = jest.fn();
const mockTtsCommand = jest.fn();
const mockShowToast = jest.fn();
const mockInjectJavaScript = jest.fn();
let mockWebViewProps: {
  onMessage(event: { nativeEvent: { data: string } }): void;
};

// Built at import time from a native module the test environment does not have.
jest.mock('react-native/Libraries/EventEmitter/NativeEventEmitter', () => ({
  __esModule: true,
  default: class {
    addListener = () => ({ remove: jest.fn() });
  },
}));

jest.mock('react-native-webview', () => ({
  __esModule: true,
  default: (props: typeof mockWebViewProps) => {
    mockWebViewProps = props;
    return null;
  },
}));

jest.mock('../../ChapterContext', () => ({
  useChapterContext: () => mockUseChapterContext(),
}));

jest.mock('../../hooks/useTtsSession', () => ({
  useTtsSession: () => ({
    command: mockTtsCommand,
    loadAndPlay: jest.fn(),
    progress: { index: 0, total: 0 },
    seekTo: jest.fn(),
    state: 'idle',
    updateSettings: jest.fn(),
  }),
}));

jest.mock('../Hooks/useCustomCode', () => ({
  __esModule: true,
  default: () => ({ customJS: '', customCSS: '' }),
}));

jest.mock('../Hooks/useTextModifications', () => ({
  __esModule: true,
  default: (html: string) => ({
    html,
    replaceModalVisible: false,
    setReplaceModalVisible: jest.fn(),
    selectedTextForReplace: '',
    replacementText: '',
    setReplacementText: jest.fn(),
    handleReplaceSave: jest.fn(),
    handleReplaceCancel: jest.fn(),
    eventTextAction: jest.fn(),
  }),
}));

jest.mock('@hooks/persisted', () => ({
  useTheme: () => ({ surface: '#222222', primary: '#666666' }),
}));

jest.mock('@hooks/persisted/useSettings', () => ({
  CHAPTER_GENERAL_SETTINGS: 'CHAPTER_GENERAL_SETTINGS',
  CHAPTER_READER_SETTINGS: 'CHAPTER_READER_SETTINGS',
  initialChapterGeneralSettings: {},
  initialChapterReaderSettings: { theme: '#000000' },
}));

jest.mock('@utils/mmkv/mmkv', () => ({
  MMKVStorage: {
    addOnValueChangedListener: () => ({ remove: jest.fn() }),
  },
  getMMKVObject: () => undefined,
}));

jest.mock('@plugins/pluginManager', () => ({
  getPlugin: () => ({ id: 'plugin.reader', site: 'https://example.com' }),
}));

jest.mock('@components/Dialog', () => {
  const Stub = () => null;
  Stub.Root = Stub;
  return { Dialog: Stub };
});

jest.mock('../../utils/sanitizeChapterText', () => ({
  isChapterRefreshUrl: () => false,
  isPluginIssueReportUrl: () => false,
}));

jest.mock('@utils/showToast', () => ({
  showToast: (...args: unknown[]) => mockShowToast(...args),
}));

jest.mock('@i18n/translations', () => ({
  getString: (key: string) => key,
}));

jest.mock('react-native-safe-area-context', () => {
  const ReactModule = require('react');
  const frame = { height: 800, width: 400, x: 0, y: 0 };
  const insets = { bottom: 0, left: 0, right: 0, top: 0 };

  return {
    SafeAreaFrameContext: ReactModule.createContext(frame),
    SafeAreaInsetsContext: ReactModule.createContext(insets),
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
    initialWindowMetrics: { frame, insets },
    useSafeAreaFrame: () => frame,
    useSafeAreaInsets: () => insets,
  };
});

jest.mock('@components/AppErrorBoundary/AppErrorBoundary', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('@screens/novel/NovelContext', () => ({
  NovelContextProvider: ({ children }: { children: React.ReactNode }) =>
    children,
}));

const STOP_SCRIPT = 'window.tts?.stop?.(); true;';

const makeContext = (overrides: object = {}) => ({
  novel: { name: 'Novel', pluginId: 'plugin.reader' },
  chapter: { id: 1, name: 'Chapter 1' },
  chapterText: '<p>original</p>',
  navigateChapter: jest.fn(),
  canAutoAdvance: jest.fn().mockResolvedValue(true),
  saveProgress: jest.fn(),
  webViewRef: { current: { injectJavaScript: mockInjectJavaScript } },
  onUserInteraction: jest.fn(),
  isTTSReadingRef: { current: false },
  refetch: jest.fn(),
  ...overrides,
});

const renderReader = () =>
  render(
    <WebViewReader
      onPress={jest.fn()}
      onSearchResult={jest.fn()}
      searchTextRef={{ current: '' }}
    />,
  );

const postMessage = async (message: object) => {
  await act(async () => {
    mockWebViewProps.onMessage({
      nativeEvent: { data: JSON.stringify(message) },
    });
  });
};

describe('WebViewReader', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('TTS session', () => {
    it('stops when the shown text changes within the same chapter', () => {
      const context = makeContext();
      mockUseChapterContext.mockReturnValue(context);

      const view = renderReader();
      expect(mockTtsCommand).not.toHaveBeenCalled();

      mockUseChapterContext.mockReturnValue({
        ...context,
        chapterText: '<p>translated</p>',
      });
      view.rerender(
        <WebViewReader
          onPress={jest.fn()}
          onSearchResult={jest.fn()}
          searchTextRef={{ current: '' }}
        />,
      );

      expect(mockTtsCommand).toHaveBeenCalledTimes(1);
      expect(mockTtsCommand).toHaveBeenCalledWith('stop');
    });

    it('keeps playing while the shown text stays the same', () => {
      const context = makeContext();
      mockUseChapterContext.mockReturnValue(context);

      const view = renderReader();

      mockUseChapterContext.mockReturnValue({
        ...context,
        chapter: { ...context.chapter, progress: 40 },
      });
      view.rerender(
        <WebViewReader
          onPress={jest.fn()}
          onSearchResult={jest.fn()}
          searchTextRef={{ current: '' }}
        />,
      );

      expect(mockTtsCommand).not.toHaveBeenCalled();
    });

    it('stops when the next chapter happens to have the same text', () => {
      const context = makeContext();
      mockUseChapterContext.mockReturnValue(context);

      const view = renderReader();

      mockUseChapterContext.mockReturnValue({
        ...context,
        chapter: { id: 2, name: 'Chapter 2' },
      });
      view.rerender(
        <WebViewReader
          onPress={jest.fn()}
          onSearchResult={jest.fn()}
          searchTextRef={{ current: '' }}
        />,
      );

      expect(mockTtsCommand).toHaveBeenCalledTimes(1);
    });

    it('stops once when the chapter and its text change together', () => {
      const context = makeContext();
      mockUseChapterContext.mockReturnValue(context);

      const view = renderReader();

      mockUseChapterContext.mockReturnValue({
        ...context,
        chapter: { id: 2, name: 'Chapter 2' },
        chapterText: '<p>next</p>',
      });
      view.rerender(
        <WebViewReader
          onPress={jest.fn()}
          onSearchResult={jest.fn()}
          searchTextRef={{ current: '' }}
        />,
      );

      expect(mockTtsCommand).toHaveBeenCalledTimes(1);
    });
  });

  describe('next chapter message', () => {
    it('stops TTS with a message when auto advance is blocked', async () => {
      const context = makeContext({
        canAutoAdvance: jest.fn().mockResolvedValue(false),
      });
      mockUseChapterContext.mockReturnValue(context);
      renderReader();

      await postMessage({ type: 'next', autoStartTTS: true });

      expect(mockShowToast).toHaveBeenCalledWith(
        'translation.reader.autoAdvanceStopped',
      );
      expect(mockInjectJavaScript).toHaveBeenCalledWith(STOP_SCRIPT);
      expect(context.navigateChapter).not.toHaveBeenCalled();
    });

    it('advances when auto advance is allowed', async () => {
      const context = makeContext();
      mockUseChapterContext.mockReturnValue(context);
      renderReader();

      await postMessage({ type: 'next', autoStartTTS: true });

      expect(context.navigateChapter).toHaveBeenCalledWith('NEXT');
      expect(mockShowToast).not.toHaveBeenCalled();
      expect(mockInjectJavaScript).not.toHaveBeenCalledWith(STOP_SCRIPT);
    });

    it('does not gate a manual next on auto advance', async () => {
      const context = makeContext({
        canAutoAdvance: jest.fn().mockResolvedValue(false),
      });
      mockUseChapterContext.mockReturnValue(context);
      renderReader();

      await postMessage({ type: 'next' });

      expect(context.canAutoAdvance).not.toHaveBeenCalled();
      expect(context.navigateChapter).toHaveBeenCalledWith('NEXT');
    });
  });
});
