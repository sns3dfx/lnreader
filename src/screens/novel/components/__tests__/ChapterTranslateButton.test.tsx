import { fireEvent, render, screen } from '@test-utils';

import { TranslateButton } from '../Chapter/ChapterTranslateButton';

jest.mock('@i18n/translations', () => ({ getString: (key: string) => key }));

jest.mock('@components', () => {
  const { createElement } = jest.requireActual('react');
  const { View, Pressable, Text } = jest.requireActual('react-native');
  const Menu = ({ visible, anchor, children }: any) =>
    createElement(View, null, anchor, visible ? children : null);
  Menu.Item = ({ title, onPress }: any) =>
    createElement(Pressable, { onPress }, createElement(Text, null, title));
  return { Menu };
});

jest.mock('@hooks/index', () => ({
  useBoolean: jest.requireActual('@hooks/common/useBoolean').default,
}));

jest.mock('@components/AppErrorBoundary/AppErrorBoundary', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => children,
}));

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

jest.mock('@screens/novel/NovelContext', () => ({
  NovelContextProvider: ({ children }: { children: React.ReactNode }) =>
    children,
}));

const theme = {
  surface: '#222',
  onSurface: '#333',
  outline: '#555',
  primary: '#666',
  rippleColor: '#777',
} as any;

const setup = (
  state: 'none' | 'translating' | 'saved',
  canTranslate = true,
) => {
  const handlers = {
    translate: jest.fn(),
    retranslate: jest.fn(),
    deleteTranslation: jest.fn(),
  };
  render(
    <TranslateButton
      state={state}
      canTranslate={canTranslate}
      theme={theme}
      {...handlers}
    />,
  );
  return handlers;
};

describe('TranslateButton', () => {
  it('starts a translation from the none state', () => {
    const handlers = setup('none');
    fireEvent.press(screen.getByLabelText('translation.chapter.translate'));
    expect(handlers.translate).toHaveBeenCalledTimes(1);
  });

  it('shows a spinner and ignores presses while translating', () => {
    const handlers = setup('translating');
    expect(screen.getByTestId('translate-spinner')).toBeTruthy();
    expect(screen.queryByLabelText('translation.chapter.translate')).toBeNull();
    expect(handlers.translate).not.toHaveBeenCalled();
  });

  it('opens a menu with retranslate and delete when saved', () => {
    const handlers = setup('saved');
    expect(screen.queryByText('translation.chapter.retranslate')).toBeNull();

    fireEvent.press(screen.getByLabelText('translation.chapter.options'));
    fireEvent.press(screen.getByText('translation.chapter.retranslate'));
    expect(handlers.retranslate).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByLabelText('translation.chapter.options'));
    fireEvent.press(screen.getByText('translation.chapter.deleteTranslation'));
    expect(handlers.deleteTranslation).toHaveBeenCalledTimes(1);
    expect(handlers.translate).not.toHaveBeenCalled();
  });

  it('hides retranslate but keeps delete when there is no key', () => {
    const handlers = setup('saved', false);
    fireEvent.press(screen.getByLabelText('translation.chapter.options'));
    expect(screen.queryByText('translation.chapter.retranslate')).toBeNull();
    fireEvent.press(screen.getByText('translation.chapter.deleteTranslation'));
    expect(handlers.deleteTranslation).toHaveBeenCalledTimes(1);
  });
});
