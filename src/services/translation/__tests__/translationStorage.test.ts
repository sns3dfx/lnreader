import NativeFile from '@modules/native-file';
import { NOVEL_STORAGE } from '@utils/Storages';
import {
  deleteTranslation,
  listTranslatedChapterIds,
  readTranslation,
  writeTranslation,
} from '../translationStorage';

const file = NativeFile as jest.Mocked<typeof NativeFile>;

const ref = {
  pluginId: 'plug',
  novelId: 7,
  chapterId: 42,
  sourceLang: 'ZH',
  targetLang: 'RU',
};
const dir = `${NOVEL_STORAGE}/plug/7/translations`;
const path = `${dir}/42.ZH-RU.json`;
const saved = { html: '<p>x</p>', title: 'T', createdAt: '2026-01-01' };

beforeEach(() => {
  jest.clearAllMocks();
  file.exists.mockResolvedValue(true);
});

describe('translationStorage', () => {
  it('stores under the novel translations folder, keyed by chapter and language pair', async () => {
    file.exists.mockResolvedValue(false);
    await writeTranslation(ref, saved);
    expect(file.mkdir).toHaveBeenCalledWith(dir);
    expect(file.moveFile).toHaveBeenCalledWith(expect.any(String), path);
  });

  it('writes to a temp file and moves it into place', async () => {
    await writeTranslation(ref, saved);
    const [tmp, content] = file.writeFile.mock.calls[0];
    expect(tmp).not.toBe(path);
    expect(JSON.parse(content)).toEqual(saved);
    expect(file.moveFile).toHaveBeenCalledWith(tmp, path);
  });

  it('reads a stored translation', async () => {
    file.readFile.mockResolvedValue(JSON.stringify(saved));
    await expect(readTranslation(ref)).resolves.toEqual(saved);
    expect(file.readFile).toHaveBeenCalledWith(path);
  });

  it('returns undefined when the file is missing or corrupt', async () => {
    file.exists.mockResolvedValue(false);
    await expect(readTranslation(ref)).resolves.toBeUndefined();
    file.exists.mockResolvedValue(true);
    file.readFile.mockResolvedValue('{broken');
    await expect(readTranslation(ref)).resolves.toBeUndefined();
  });

  it('deletes the stored file when present', async () => {
    await deleteTranslation(ref);
    expect(file.unlink).toHaveBeenCalledWith(path);
  });

  it('lists only ids for the requested language pair', async () => {
    file.readDir.mockResolvedValue([
      { name: '1.ZH-RU.json', path: '', isDirectory: false },
      { name: '2.ZH-EN.json', path: '', isDirectory: false },
      { name: '3.ZH-RU.json.tmp', path: '', isDirectory: false },
      { name: '4.ZH-RU.json', path: '', isDirectory: false },
    ]);
    await expect(
      listTranslatedChapterIds('plug', 7, 'ZH', 'RU'),
    ).resolves.toEqual(new Set([1, 4]));
  });

  it('returns an empty set when the folder does not exist', async () => {
    file.exists.mockResolvedValue(false);
    await expect(
      listTranslatedChapterIds('plug', 7, 'ZH', 'RU'),
    ).resolves.toEqual(new Set());
    expect(file.readDir).not.toHaveBeenCalled();
  });
});
