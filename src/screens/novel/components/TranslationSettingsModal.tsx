import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';

import { Dialog } from '@components/Dialog';
import { useNovelSettings } from '@hooks/persisted/useNovelSettings';
import { useDeepLKey } from '@hooks/persisted/useDeepLKey';
import { getString } from '@i18n/translations';
import NativeFile from '@modules/native-file';
import { useNovelValue } from '@screens/novel/NovelContext';
import {
  DeepLLanguage,
  listDeepLLanguages,
  TranslationError,
  upsertGlossaryDictionary,
} from '@services/translation/deeplClient';
import {
  GlossaryFileError,
  parseGlossaryTsv,
} from '@services/translation/glossaryFile';
import { translationErrorMessage } from '@services/translation/translationErrorMessage';
import { getGlossaryPairKey } from '@services/translation/translationSettings';
import { ThemeColors } from '@theme/types';
import { showToast } from '@utils/showToast';

interface TranslationSettingsModalProps {
  visible: boolean;
  onDismiss: () => void;
  theme: ThemeColors;
}

const AUTO = 'auto';

const glossaryFileErrorMessage = (error: GlossaryFileError): string => {
  switch (error.code) {
    case 'bad_line':
      return getString('translation.novel.glossaryBadLine', {
        line: error.line,
      });
    case 'duplicate':
      return getString('translation.novel.glossaryDuplicate', {
        line: error.line,
      });
    default:
      return getString('translation.novel.glossaryEmpty');
  }
};

const LanguageChips = ({
  options,
  selected,
  onSelect,
  theme,
}: {
  options: { code: string; name: string }[];
  selected: string | undefined;
  onSelect: (code: string) => void;
  theme: ThemeColors;
}) => (
  <ScrollView style={styles.chipScroll} nestedScrollEnabled>
    <View style={styles.chips}>
      {options.map(option => {
        const isSelected = option.code === selected;
        return (
          <Pressable
            key={option.code}
            onPress={() => onSelect(option.code)}
            style={[
              styles.chip,
              {
                borderColor: isSelected ? theme.primary : theme.outline,
                backgroundColor: isSelected ? theme.rippleColor : undefined,
              },
            ]}
          >
            <Text
              style={{
                color: isSelected ? theme.primary : theme.onSurfaceVariant,
              }}
            >
              {option.name}
            </Text>
          </Pressable>
        );
      })}
    </View>
  </ScrollView>
);

const TranslationSettingsModal = ({
  visible,
  onDismiss,
  theme,
}: TranslationSettingsModalProps) => {
  const { translation, setTranslation } = useNovelSettings();
  const novel = useNovelValue('novel');
  const { apiKey } = useDeepLKey();
  const [languages, setLanguages] = useState<DeepLLanguage[]>([]);
  const [error, setError] = useState<string>();
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!visible || !apiKey) {
      return;
    }
    let active = true;
    listDeepLLanguages(apiKey)
      .then(result => {
        if (active) {
          setLanguages(result);
        }
      })
      .catch(e => {
        if (active) {
          setError(
            translationErrorMessage(
              e instanceof TranslationError ? e.code : 'unknown',
            ),
          );
        }
      });
    return () => {
      active = false;
    };
  }, [visible, apiKey]);

  const sourceLang = translation?.sourceLang.toLowerCase() ?? AUTO;
  const targetLang = translation?.targetLang.toLowerCase() ?? '';

  const sourceOptions = [
    { code: AUTO, name: getString('translation.novel.autoDetect') },
    ...languages
      .filter(language => language.source)
      .map(language => ({
        code: language.code.toLowerCase(),
        name: language.name,
      })),
  ];
  const targetOptions = languages
    .filter(language => language.target)
    .map(language => ({
      code: language.code.toLowerCase(),
      name: language.name,
    }));

  const pairKey = getGlossaryPairKey(sourceLang, targetLang);
  const entryCount = translation?.glossaries[pairKey]?.entryCount;
  const canUpload = sourceLang !== AUTO && !!targetLang;

  const selectSource = useCallback(
    (code: string) => setTranslation({ sourceLang: code }),
    [setTranslation],
  );
  const selectTarget = useCallback(
    (code: string) => setTranslation({ targetLang: code }),
    [setTranslation],
  );

  const uploadGlossary = async () => {
    if (!apiKey || uploading) {
      return;
    }
    setError(undefined);
    if (!canUpload) {
      setError(getString('translation.novel.glossaryNeedsSource'));
      return;
    }
    setUploading(true);
    try {
      const file = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: false,
        type: ['text/tab-separated-values', 'text/plain'],
      });
      if (file.canceled || !file.assets?.length) {
        return;
      }
      const tempPath =
        NativeFile.ExternalCachesDirectoryPath + '/imported_glossary.tsv';
      await NativeFile.copyFile(file.assets[0].uri, tempPath);
      const content = await NativeFile.readFile(tempPath);
      await NativeFile.unlink(tempPath);

      const { entryCount: count, tsv } = parseGlossaryTsv(content);
      const glossaryId = await upsertGlossaryDictionary(apiKey, {
        glossaryId: translation?.glossaryId,
        name: `LNReader ${novel?.name ?? ''}`.trim(),
        sourceLang,
        targetLang,
        tsv,
      });
      setTranslation({
        glossaryId,
        glossaries: {
          // A new id means the old glossary is gone, with all its pairs.
          ...(glossaryId === translation?.glossaryId
            ? translation?.glossaries
            : {}),
          [pairKey]: { entryCount: count },
        },
      });
      showToast(getString('translation.novel.glossaryUploaded'));
    } catch (e) {
      if (e instanceof GlossaryFileError) {
        setError(glossaryFileErrorMessage(e));
      } else if (e instanceof TranslationError) {
        setError(translationErrorMessage(e.code));
      } else {
        setError(
          (e as Error)?.message ?? getString('translation.errors.unknown'),
        );
      }
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog.Root visible={visible} onDismiss={onDismiss}>
      <Dialog.Header>
        <Dialog.Title>{getString('translation.novel.title')}</Dialog.Title>
      </Dialog.Header>
      <Dialog.Content>
        {!apiKey ? (
          <Text style={{ color: theme.onSurfaceVariant }}>
            {getString('translation.novel.noKey')}
          </Text>
        ) : (
          <ScrollView nestedScrollEnabled>
            <Text style={[styles.label, { color: theme.onSurfaceVariant }]}>
              {getString('translation.novel.sourceLanguage')}
            </Text>
            <LanguageChips
              options={sourceOptions}
              selected={sourceLang}
              onSelect={selectSource}
              theme={theme}
            />
            <Text style={[styles.label, { color: theme.onSurfaceVariant }]}>
              {getString('translation.novel.targetLanguage')}
            </Text>
            <LanguageChips
              options={targetOptions}
              selected={targetLang}
              onSelect={selectTarget}
              theme={theme}
            />
            <Text style={[styles.label, { color: theme.onSurfaceVariant }]}>
              {getString('translation.novel.glossary')}
            </Text>
            {entryCount !== undefined ? (
              <Text style={{ color: theme.onSurface }}>
                {getString('translation.novel.glossaryEntries', {
                  count: entryCount,
                })}
              </Text>
            ) : null}
            {error ? (
              <Text style={[styles.error, { color: theme.error }]}>
                {error}
              </Text>
            ) : null}
          </ScrollView>
        )}
      </Dialog.Content>
      <Dialog.Actions>
        {apiKey ? (
          <Dialog.Action onPress={uploadGlossary} disabled={uploading}>
            {getString('translation.novel.uploadGlossary')}
          </Dialog.Action>
        ) : null}
        <Dialog.Action onPress={onDismiss}>
          {getString('common.close')}
        </Dialog.Action>
      </Dialog.Actions>
    </Dialog.Root>
  );
};

export default TranslationSettingsModal;

const styles = StyleSheet.create({
  label: { fontSize: 12, marginBottom: 6, marginTop: 12 },
  chipScroll: { maxHeight: 120 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  error: { marginTop: 8 },
});
