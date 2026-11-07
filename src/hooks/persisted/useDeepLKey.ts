import { useCallback } from 'react';
import { useMMKVString } from 'react-native-mmkv';
import { MMKVStorage } from '@utils/mmkv/mmkv';

export const DEEPL_API_KEY = 'DEEPL_API_KEY';

export const getDeepLApiKey = (): string | undefined =>
  MMKVStorage.getString(DEEPL_API_KEY) || undefined;

export function useDeepLKey() {
  const [apiKey, setStoredKey] = useMMKVString(DEEPL_API_KEY);

  const setApiKey = useCallback(
    (key: string) => setStoredKey(key),
    [setStoredKey],
  );
  const clearApiKey = useCallback(
    () => setStoredKey(undefined),
    [setStoredKey],
  );

  return { apiKey: apiKey || undefined, setApiKey, clearApiKey };
}
