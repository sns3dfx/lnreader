import { fireEvent, render, screen, waitFor } from '@test-utils';

import {
  checkDeepLKey,
  TranslationError,
} from '@services/translation/deeplClient';

import SettingsTranslationScreen from '../SettingsTranslationScreen';

jest.mock('@services/translation/deeplClient', () => {
  const actual = jest.requireActual('@services/translation/deeplClient');
  return { ...actual, checkDeepLKey: jest.fn() };
});

jest.mock('@hooks/persisted', () => ({
  useTheme: () => ({
    background: '#111',
    surface: '#222',
    onSurface: '#333',
    onSurfaceVariant: '#444',
    outline: '#555',
    primary: '#666',
    error: '#f00',
    rippleColor: '#777',
  }),
}));

jest.mock('@components/AppErrorBoundary/AppErrorBoundary', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('@screens/novel/NovelContext', () => ({
  NovelContextProvider: ({ children }: { children: React.ReactNode }) =>
    children,
}));

jest.mock('react-native-safe-area-context', () => {
  const ReactModule = require('react');
  const { View } = jest.requireActual('react-native');
  const frame = { height: 800, width: 400, x: 0, y: 0 };
  const insets = { bottom: 0, left: 0, right: 0, top: 0 };

  return {
    SafeAreaFrameContext: ReactModule.createContext(frame),
    SafeAreaInsetsContext: ReactModule.createContext(insets),
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
    SafeAreaView: ({ children, ...props }: { children: React.ReactNode }) =>
      ReactModule.createElement(View, props, children),
    initialWindowMetrics: { frame, insets },
    useSafeAreaFrame: () => frame,
    useSafeAreaInsets: () => insets,
  };
});

jest.mock('@utils/showToast', () => ({ showToast: jest.fn() }));

jest.mock('@i18n/translations', () => ({
  getString: (key: string, params?: Record<string, unknown>) =>
    params ? `${key} ${JSON.stringify(params)}` : key,
}));

let mockKey: string | undefined;
const mockSetApiKey = jest.fn((key: string) => {
  mockKey = key;
});
const mockClearApiKey = jest.fn(() => {
  mockKey = undefined;
});

jest.mock('@hooks/persisted/useDeepLKey', () => ({
  useDeepLKey: () => ({
    apiKey: mockKey,
    setApiKey: mockSetApiKey,
    clearApiKey: mockClearApiKey,
  }),
}));

const navigation = { goBack: jest.fn() } as any;
const route = { key: 'k', name: 'TranslationSettings' } as any;

const renderScreen = () =>
  render(<SettingsTranslationScreen navigation={navigation} route={route} />);

describe('SettingsTranslationScreen', () => {
  beforeEach(() => {
    mockKey = undefined;
    jest.clearAllMocks();
  });

  it('saves a key only after DeepL accepts it', async () => {
    let resolveCheck!: (v: {
      characterCount: number;
      characterLimit: number;
    }) => void;
    jest.mocked(checkDeepLKey).mockReturnValue(
      new Promise(resolve => {
        resolveCheck = resolve;
      }),
    );
    renderScreen();

    fireEvent.changeText(
      screen.getByPlaceholderText('translation.settings.apiKey'),
      'new-key:fx',
    );
    fireEvent.press(screen.getByText('translation.settings.saveKey'));

    expect(checkDeepLKey).toHaveBeenCalledWith('new-key:fx');
    expect(mockSetApiKey).not.toHaveBeenCalled();

    resolveCheck({ characterCount: 10, characterLimit: 100 });
    await waitFor(() =>
      expect(mockSetApiKey).toHaveBeenCalledWith('new-key:fx'),
    );
  });

  it('shows the invalid key message and keeps the old key on 403', async () => {
    mockKey = 'old-key';
    jest
      .mocked(checkDeepLKey)
      .mockRejectedValue(new TranslationError('invalid_key'));
    renderScreen();

    fireEvent.changeText(
      screen.getByPlaceholderText('translation.settings.apiKey'),
      'bad-key',
    );
    fireEvent.press(screen.getByText('translation.settings.saveKey'));

    await screen.findByText('translation.errors.invalidKey');
    expect(mockSetApiKey).not.toHaveBeenCalled();
    expect(mockClearApiKey).not.toHaveBeenCalled();
    expect(mockKey).toBe('old-key');
  });

  it('shows remaining characters after a successful check', async () => {
    jest
      .mocked(checkDeepLKey)
      .mockResolvedValue({ characterCount: 250, characterLimit: 1000 });
    renderScreen();

    fireEvent.changeText(
      screen.getByPlaceholderText('translation.settings.apiKey'),
      'good:fx',
    );
    fireEvent.press(screen.getByText('translation.settings.saveKey'));

    await screen.findByText(
      'translation.settings.charactersRemaining {"remaining":750,"limit":1000}',
    );
  });

  it('clears the key', () => {
    mockKey = 'old-key';
    renderScreen();

    fireEvent.press(screen.getByText('translation.settings.clearKey'));

    expect(mockClearApiKey).toHaveBeenCalled();
  });
});
