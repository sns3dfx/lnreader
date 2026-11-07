import NativeFile from '@modules/native-file';
import { NOVEL_STORAGE } from '@utils/Storages';
import { fetchChapter } from '@services/plugin/fetch';
import { TranslationError, translateTexts } from '../deeplClient';
import { readTranslation, writeTranslation } from '../translationStorage';
import { splitChapterHtml, translateChapter } from '../translateChapter';

jest.mock('../deeplClient', () => ({
  ...jest.requireActual('../deeplClient'),
  translateTexts: jest.fn(),
}));
jest.mock('../translationStorage');
jest.mock('@services/plugin/fetch', () => ({ fetchChapter: jest.fn() }));

const file = NativeFile as jest.Mocked<typeof NativeFile>;
const translate = translateTexts as jest.Mock;
const read = readTranslation as jest.Mock;
const write = writeTranslation as jest.Mock;
const fetchSrc = fetchChapter as jest.Mock;

const params = {
  apiKey: 'k',
  pluginId: 'plug',
  novelId: 7,
  chapter: { id: 42, path: '/c/42', name: 'Title' },
  sourceLang: 'ZH',
  targetLang: 'RU',
};
const saved = { html: '<p>done</p>', title: 'T', createdAt: 'x' };

const echoTranslate = async (_key: string, { texts }: { texts: string[] }) =>
  texts.map(t => `T:${t}`);

beforeEach(() => {
  jest.resetAllMocks();
  read.mockResolvedValue(undefined);
  write.mockResolvedValue(undefined);
  file.readFile.mockResolvedValue('<p>one</p><p>two</p>');
  translate.mockImplementation(echoTranslate);
});

describe('translateChapter', () => {
  it('returns a saved translation without calling DeepL', async () => {
    read.mockResolvedValue(saved);
    await expect(translateChapter(params)).resolves.toBe(saved);
    expect(translate).not.toHaveBeenCalled();
  });

  it('calls DeepL when force is true', async () => {
    read.mockResolvedValue(saved);
    await translateChapter({ ...params, force: true });
    expect(translate).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('sends the title first and the chapter parts after it', async () => {
    const result = await translateChapter(params);
    expect(translate.mock.calls[0][1].texts).toEqual([
      'Title',
      '<p>one</p><p>two</p>',
    ]);
    expect(result.title).toBe('T:Title');
    expect(result.html).toBe('T:<p>one</p><p>two</p>');
  });

  it('joins long chapters in order and keeps img src', async () => {
    const html = '<p>a</p><img src="https://x/y.png"><p>b</p>';
    file.readFile.mockResolvedValue(html);
    const parts = splitChapterHtml(html, 10);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.join('')).toBe(html);

    const result = await translateChapter(params);
    expect(result.html).toContain('src="https://x/y.png"');
  });

  it('never splits inside a tag', () => {
    const html = '<p class="a b">hello <b>w</b></p><div id="x">text</div>';
    const parts = splitChapterHtml(html, 5);
    expect(parts).toHaveLength(2);
    for (const part of parts) {
      expect(part.match(/</g)?.length).toBe(part.match(/>/g)?.length);
      expect(part.startsWith('<')).toBe(true);
    }
  });

  it('shares one request between concurrent calls for the same chapter and pair', async () => {
    const [a, b] = await Promise.all([
      translateChapter(params),
      translateChapter(params),
    ]);
    expect(a).toBe(b);
    expect(translate).toHaveBeenCalledTimes(1);
  });

  it('runs separately for a different language pair', async () => {
    await Promise.all([
      translateChapter(params),
      translateChapter({ ...params, targetLang: 'EN' }),
    ]);
    expect(translate).toHaveBeenCalledTimes(2);
  });

  it('saves nothing when DeepL returns empty_result', async () => {
    translate.mockRejectedValue(new TranslationError('empty_result'));
    await expect(translateChapter(params)).rejects.toMatchObject({
      code: 'empty_result',
    });
    expect(write).not.toHaveBeenCalled();
  });

  it('rejects with empty_result and no DeepL call when the source is empty', async () => {
    file.readFile.mockResolvedValue('<p> </p><br>');
    await expect(translateChapter(params)).rejects.toMatchObject({
      code: 'empty_result',
    });
    expect(translate).not.toHaveBeenCalled();
  });

  it('records the glossary id', async () => {
    const result = await translateChapter({ ...params, glossaryId: 'g1' });
    expect(result.glossaryId).toBe('g1');
    expect(write.mock.calls[0][1].glossaryId).toBe('g1');
  });

  it('reads the downloaded file before asking the plugin', async () => {
    await translateChapter(params);
    expect(file.readFile).toHaveBeenCalledWith(
      `${NOVEL_STORAGE}/plug/7/42/index.html`,
    );
    expect(fetchSrc).not.toHaveBeenCalled();

    file.readFile.mockRejectedValue(new Error('missing'));
    fetchSrc.mockResolvedValue('<p>net</p>');
    await translateChapter({ ...params, targetLang: 'EN' });
    expect(fetchSrc).toHaveBeenCalledWith('plug', '/c/42');
  });
});
