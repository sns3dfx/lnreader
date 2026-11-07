import { fireEvent, render, screen, waitFor } from '@test-utils';
import * as DocumentPicker from 'expo-document-picker';

import NativeFile from '@modules/native-file';
import {
  listDeepLLanguages,
  upsertGlossaryDictionary,
} from '@services/translation/deeplClient';
import { getGlossaryIdForPair } from '@services/translation/translationSettings';
import type { NovelTranslationSettings } from '@hooks/persisted/useNovel/types';

import TranslationSettingsModal from '../TranslationSettingsModal';

jest.mock('@services/translation/deeplClient', () => {
  const actual = jest.requireActual('@services/translation/deeplClient');
  return {
    ...actual,
    listDeepLLanguages: jest.fn(),
    upsertGlossaryDictionary: jest.fn(),
  };
});

jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));

jest.mock('@modules/native-file', () => ({
  __esModule: true,
  default: {
    ExternalCachesDirectoryPath: '/cache',
    copyFile: jest.fn(),
    readFile: jest.fn(),
    unlink: jest.fn(),
  },
}));

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

jest.mock('@components/AppErrorBoundary/AppErrorBoundary', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => children,
}));

let mockKey: string | undefined;
jest.mock('@hooks/persisted/useDeepLKey', () => ({
  useDeepLKey: () => ({ apiKey: mockKey }),
}));

let mockTranslation: NovelTranslationSettings | undefined;
const mockSetTranslation = jest.fn();
jest.mock('@hooks/persisted/useNovelSettings', () => ({
  useNovelSettings: () => ({
    translation: mockTranslation,
    setTranslation: mockSetTranslation,
  }),
}));

jest.mock('@screens/novel/NovelContext', () => ({
  NovelContextProvider: ({ children }: { children: React.ReactNode }) =>
    children,
  useNovelValue: () => ({ id: 1, name: 'My Novel' }),
}));

const theme = {
  background: '#111',
  surface: '#222',
  onSurface: '#333',
  onSurfaceVariant: '#444',
  outline: '#555',
  primary: '#666',
  onPrimary: '#fff',
  error: '#f00',
  rippleColor: '#777',
} as any;

const languages = [
  { code: 'EN', name: 'English', source: true, target: true },
  { code: 'DE', name: 'German', source: true, target: true },
  { code: 'JA', name: 'Japanese', source: true, target: false },
  { code: 'RU', name: 'Russian', source: false, target: true },
];

const renderModal = () =>
  render(
    <TranslationSettingsModal visible onDismiss={jest.fn()} theme={theme} />,
  );

const pickFile = (content: string) => {
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'content://glossary.tsv' }],
  } as any);
  jest.mocked(NativeFile.readFile).mockResolvedValue(content);
};

describe('TranslationSettingsModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockKey = 'key:fx';
    mockTranslation = {
      sourceLang: 'ja',
      targetLang: 'en',
      showTranslation: false,
      glossaries: {},
    };
    jest.mocked(listDeepLLanguages).mockResolvedValue(languages);
  });

  it('shows source and target languages from DeepL', async () => {
    renderModal();

    expect(await screen.findAllByText('Japanese')).toHaveLength(1);
    expect(screen.getAllByText('English')).toHaveLength(2);
    expect(screen.getAllByText('Russian')).toHaveLength(1);
    expect(screen.getByText('translation.novel.autoDetect')).toBeTruthy();
  });

  it('creates the settings with the picked language codes in lowercase', async () => {
    mockTranslation = undefined;
    renderModal();

    await screen.findByText('Japanese');
    fireEvent.press(screen.getByText('Japanese'));
    expect(mockSetTranslation).toHaveBeenCalledWith({ sourceLang: 'ja' });

    fireEvent.press(screen.getByText('Russian'));
    expect(mockSetTranslation).toHaveBeenCalledWith({ targetLang: 'ru' });
  });

  it('uploads a glossary file and shows the entry count', async () => {
    pickFile('魔王\tDemon King\n勇者\tHero');
    jest.mocked(upsertGlossaryDictionary).mockResolvedValue('gloss-1');
    renderModal();

    fireEvent.press(
      await screen.findByText('translation.novel.uploadGlossary'),
    );

    await waitFor(() =>
      expect(upsertGlossaryDictionary).toHaveBeenCalledWith('key:fx', {
        glossaryId: undefined,
        name: expect.stringContaining('My Novel'),
        sourceLang: 'ja',
        targetLang: 'en',
        tsv: '魔王\tDemon King\n勇者\tHero',
      }),
    );
    expect(mockSetTranslation).toHaveBeenCalledWith({
      glossaryId: 'gloss-1',
      glossaries: { 'ja-en': { entryCount: 2 } },
    });
  });

  it('shows the entry count of an existing glossary', async () => {
    mockTranslation = {
      ...mockTranslation!,
      glossaryId: 'gloss-1',
      glossaries: { 'ja-en': { entryCount: 7 } },
    };
    renderModal();

    expect(
      await screen.findByText('translation.novel.glossaryEntries {"count":7}'),
    ).toBeTruthy();
  });

  it('shows the parse error and sends nothing for a bad file', async () => {
    pickFile('no tab here');
    renderModal();

    fireEvent.press(
      await screen.findByText('translation.novel.uploadGlossary'),
    );

    await screen.findByText('translation.novel.glossaryBadLine {"line":1}');
    expect(upsertGlossaryDictionary).not.toHaveBeenCalled();
    expect(mockSetTranslation).not.toHaveBeenCalled();
  });

  it('disables glossary upload while the source language is auto', async () => {
    mockTranslation = { ...mockTranslation!, sourceLang: 'auto' };
    renderModal();

    fireEvent.press(
      await screen.findByText('translation.novel.uploadGlossary'),
    );

    expect(
      screen.getByText('translation.novel.glossaryNeedsSource'),
    ).toBeTruthy();
    expect(DocumentPicker.getDocumentAsync).not.toHaveBeenCalled();
  });

  it('reuses the existing glossary id for a second language pair', async () => {
    mockTranslation = {
      sourceLang: 'de',
      targetLang: 'en',
      showTranslation: false,
      glossaryId: 'gloss-1',
      glossaries: { 'ja-en': { entryCount: 2 } },
    };
    pickFile('Held\tHero');
    jest.mocked(upsertGlossaryDictionary).mockResolvedValue('gloss-1');
    renderModal();

    fireEvent.press(
      await screen.findByText('translation.novel.uploadGlossary'),
    );

    await waitFor(() =>
      expect(upsertGlossaryDictionary).toHaveBeenCalledWith(
        'key:fx',
        expect.objectContaining({
          glossaryId: 'gloss-1',
          sourceLang: 'de',
          targetLang: 'en',
        }),
      ),
    );
    expect(mockSetTranslation).toHaveBeenCalledWith({
      glossaryId: 'gloss-1',
      glossaries: {
        'ja-en': { entryCount: 2 },
        'de-en': { entryCount: 1 },
      },
    });
  });

  it('drops the pairs of a dead glossary when DeepL returns a new id', async () => {
    mockTranslation = {
      sourceLang: 'de',
      targetLang: 'en',
      showTranslation: false,
      glossaryId: 'gloss-dead',
      glossaries: {
        'ja-en': { entryCount: 2 },
        'de-en': { entryCount: 5 },
      },
    };
    pickFile('Held\tHero');
    jest.mocked(upsertGlossaryDictionary).mockResolvedValue('gloss-new');
    renderModal();

    fireEvent.press(
      await screen.findByText('translation.novel.uploadGlossary'),
    );

    await waitFor(() =>
      expect(mockSetTranslation).toHaveBeenCalledWith({
        glossaryId: 'gloss-new',
        glossaries: { 'de-en': { entryCount: 1 } },
      }),
    );
  });

  it('shows a hint to add the key when none is set', () => {
    mockKey = undefined;
    renderModal();

    expect(screen.getByText('translation.novel.noKey')).toBeTruthy();
    expect(listDeepLLanguages).not.toHaveBeenCalled();
  });

  it('returns no glossary id for a pair without a dictionary', () => {
    const settings: NovelTranslationSettings = {
      sourceLang: 'de',
      targetLang: 'en',
      showTranslation: false,
      glossaryId: 'gloss-1',
      glossaries: { 'ja-en': { entryCount: 2 } },
    };

    expect(getGlossaryIdForPair(settings)).toBeUndefined();
    expect(getGlossaryIdForPair({ ...settings, sourceLang: 'ja' })).toBe(
      'gloss-1',
    );
  });
});
