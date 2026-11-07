import { MMKVStorage } from '@utils/mmkv/mmkv';
import { backupMMKVData } from '../utils';

jest.mock('@database/queries/NovelQueries', () => ({}));
jest.mock('@database/queries/ChapterQueries', () => ({}));
jest.mock('@database/queries/CategoryQueries', () => ({}));
jest.mock('@hooks/persisted/useSelfHost', () => ({
  SELF_HOST_BACKUP: 'SELF_HOST_BACKUP',
}));
jest.mock('@hooks/persisted/migrations/trackerMigration', () => ({
  OLD_TRACKED_NOVEL_PREFIX: 'OLD_TRACKED_NOVEL_PREFIX',
}));
jest.mock('@hooks/persisted/useUpdates', () => ({
  LAST_UPDATE_TIME: 'LAST_UPDATE_TIME',
}));
jest.mock('@plugins/pluginManager', () => ({
  INSTALLED_PLUGINS_KEY: 'INSTALL_PLUGINS',
}));
jest.mock('@utils/Storages', () => ({
  NOVEL_STORAGE: '/storage/Novels',
  ROOT_STORAGE: '/storage',
}));
jest.mock('@i18n/translations', () => ({
  getString: (key: string) => key,
}));
jest.mock('@utils/mmkv/mmkv', () => ({
  MMKVStorage: {
    getAllKeys: jest.fn(),
    getBoolean: jest.fn(),
    getString: jest.fn(),
    set: jest.fn(),
  },
}));

describe('backup MMKV keys', () => {
  it('never includes the DeepL key in a backup', () => {
    jest
      .mocked(MMKVStorage.getAllKeys)
      .mockReturnValue(['DEEPL_API_KEY', 'OTHER_SETTING']);
    jest
      .mocked(MMKVStorage.getString)
      .mockImplementation(key =>
        key === 'DEEPL_API_KEY' ? 'secret:fx' : 'value',
      );

    const data = backupMMKVData();

    expect(data).toEqual({ OTHER_SETTING: 'value' });
    expect(JSON.stringify(data)).not.toContain('secret');
  });
});
