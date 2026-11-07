import { fireEvent, render, screen } from '@test-utils';

import type { NovelTranslationSettings } from '@hooks/persisted/useNovel/types';

import ReaderAppbar from '../ReaderAppbar';

const mockToggleTranslation = jest.fn();
const mockUseChapterContext = jest.fn();

jest.mock('../../ChapterContext', () => ({
  useChapterContext: () => mockUseChapterContext(),
}));

jest.mock('@database/queries/ChapterQueries', () => ({
  bookmarkChapter: jest.fn(),
}));

jest.mock('../../../../components', () => ({
  IconButtonV2: jest.requireActual('@components/IconButtonV2/IconButtonV2')
    .default,
  Menu: () => null,
}));

jest.mock('../ReaderSearchbar', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@screens/novel/components/TranslationSettingsModal', () => {
  const { Text: MockText } = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: ({ visible }: { visible: boolean }) =>
      visible ? <MockText>translation settings</MockText> : null,
  };
});

jest.mock('@hooks/persisted', () => ({
  useTheme: () => ({ primary: '#666', onSurface: '#333', surface: '#222' }),
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

jest.mock('@i18n/translations', () => ({
  getString: (key: string) => key,
}));

jest.mock('@components/AppErrorBoundary/AppErrorBoundary', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => children,
}));

let mockTranslation: NovelTranslationSettings | undefined;
jest.mock('@hooks/persisted/useNovelSettings', () => ({
  useNovelSettings: () => ({ translation: mockTranslation }),
}));

jest.mock('@screens/novel/NovelContext', () => ({
  NovelContextProvider: ({ children }: { children: React.ReactNode }) =>
    children,
  useNovelLayout: () => ({ statusBarHeight: 0 }),
}));

const theme = {
  surface: '#222222',
  onSurface: '#333333',
  onSurfaceVariant: '#444444',
  primary: '#666666',
  rippleColor: '#777777',
} as any;

const TOGGLE = 'translation.reader.toggle';
const SPINNER = 'translation.reader.translating';

const chapterContext = (overrides: object = {}) => ({
  chapter: { id: 1, name: 'Chapter 1', bookmark: false },
  novel: { name: 'Novel', isLocal: false },
  refetch: jest.fn(),
  translating: false,
  showingTranslation: false,
  translationAvailable: true,
  translatedTitle: undefined,
  toggleTranslation: mockToggleTranslation,
  ...overrides,
});

const renderAppbar = () =>
  render(
    <ReaderAppbar
      theme={theme}
      goBack={jest.fn()}
      bookmarked={false}
      setBookmarked={jest.fn()}
      searchVisible={false}
      setSearchVisible={jest.fn()}
      searchText=""
      setSearchText={jest.fn()}
      searchResult={{} as any}
      resetSearchResult={jest.fn()}
      resetSearch={jest.fn()}
      openInWebView={jest.fn()}
      openInBrowser={jest.fn()}
      shareChapter={jest.fn()}
    />,
  );

describe('ReaderAppbar translation button', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTranslation = {
      sourceLang: 'zh',
      targetLang: 'ru',
      showTranslation: false,
      glossaries: {},
    };
    mockUseChapterContext.mockReturnValue(chapterContext());
  });

  it('hides the button when translation is unavailable', () => {
    mockUseChapterContext.mockReturnValue(
      chapterContext({ translationAvailable: false }),
    );

    renderAppbar();

    expect(screen.queryByLabelText(TOGGLE)).toBeNull();
  });

  it('toggles on press and opens language settings on long press', () => {
    renderAppbar();

    fireEvent.press(screen.getByLabelText(TOGGLE));
    expect(mockToggleTranslation).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('translation settings')).toBeNull();

    fireEvent(screen.getByLabelText(TOGGLE), 'longPress');
    expect(mockToggleTranslation).toHaveBeenCalledTimes(1);
    expect(screen.getByText('translation settings')).toBeTruthy();
  });

  it.each([
    ['no settings', undefined],
    [
      'an empty target',
      {
        sourceLang: 'auto',
        targetLang: '',
        showTranslation: false,
        glossaries: {},
      },
    ],
  ])('opens language settings when no languages are set (%s)', (_, value) => {
    mockTranslation = value;

    renderAppbar();
    fireEvent.press(screen.getByLabelText(TOGGLE));

    expect(mockToggleTranslation).not.toHaveBeenCalled();
    expect(screen.getByText('translation settings')).toBeTruthy();
  });

  it('shows a spinner while translating', () => {
    mockUseChapterContext.mockReturnValue(
      chapterContext({ translating: true }),
    );

    renderAppbar();

    expect(screen.getByLabelText(SPINNER)).toBeTruthy();
    expect(screen.queryByLabelText(TOGGLE)).toBeNull();
  });

  it.each([
    [true, theme.primary],
    [false, theme.onSurface],
  ])('colours the icon when showingTranslation is %s', (showing, iconColor) => {
    mockUseChapterContext.mockReturnValue(
      chapterContext({ showingTranslation: showing }),
    );

    renderAppbar();

    expect(
      screen.UNSAFE_getByProps({ name: 'translate', color: iconColor }),
    ).toBeTruthy();
  });

  it('shows the translated title', () => {
    mockUseChapterContext.mockReturnValue(
      chapterContext({ translatedTitle: 'Глава 1' }),
    );

    renderAppbar();

    expect(screen.getByText('Глава 1')).toBeTruthy();
    expect(screen.queryByText('Chapter 1')).toBeNull();
  });

  it('falls back to the chapter name without a translated title', () => {
    renderAppbar();

    expect(screen.getByText('Chapter 1')).toBeTruthy();
  });
});
