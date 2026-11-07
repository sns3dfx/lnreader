import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { useTheme } from '@hooks/persisted';
import { useDeepLKey } from '@hooks/persisted/useDeepLKey';
import { Appbar, Button, List, SafeAreaView } from '@components';
import { TranslationSettingsScreenProps } from '@navigators/types';
import { getString } from '@i18n/translations';
import {
  checkDeepLKey,
  TranslationError,
} from '@services/translation/deeplClient';
import { translationErrorMessage } from '@services/translation/translationErrorMessage';
import { showToast } from '@utils/showToast';

interface Usage {
  characterCount: number;
  characterLimit: number;
}

const SettingsTranslationScreen = ({
  navigation,
}: TranslationSettingsScreenProps) => {
  const theme = useTheme();
  const { apiKey, setApiKey, clearApiKey } = useDeepLKey();

  const [input, setInput] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string>();
  const [usage, setUsage] = useState<Usage>();

  const saveKey = async () => {
    const candidate = input.trim();
    if (!candidate || checking) {
      return;
    }
    setChecking(true);
    setError(undefined);
    try {
      const result = await checkDeepLKey(candidate);
      setApiKey(candidate);
      setUsage(result);
      setInput('');
      showToast(getString('translation.settings.keySaved'));
    } catch (e) {
      setUsage(undefined);
      setError(
        translationErrorMessage(
          e instanceof TranslationError ? e.code : 'unknown',
        ),
      );
    } finally {
      setChecking(false);
    }
  };

  const removeKey = () => {
    clearApiKey();
    setUsage(undefined);
    setError(undefined);
  };

  return (
    <SafeAreaView excludeTop>
      <Appbar
        title={getString('translation.settings.title')}
        handleGoBack={() => navigation.goBack()}
        theme={theme}
      />
      <View style={[{ backgroundColor: theme.background }, styles.container]}>
        <List.Section>
          <List.SubHeader theme={theme}>
            {getString('translation.settings.apiKey')}
          </List.SubHeader>
          <View style={styles.form}>
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: theme.surface,
                  color: theme.onSurface,
                  borderColor: error ? theme.error : theme.outline,
                },
              ]}
              placeholder={getString('translation.settings.apiKey')}
              placeholderTextColor={theme.onSurfaceVariant}
              value={input}
              onChangeText={setInput}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              editable={!checking}
            />
            {error ? (
              <Text style={[styles.message, { color: theme.error }]}>
                {error}
              </Text>
            ) : null}
            {usage ? (
              <Text style={[styles.message, { color: theme.onSurfaceVariant }]}>
                {getString('translation.settings.charactersRemaining', {
                  remaining: Math.max(
                    usage.characterLimit - usage.characterCount,
                    0,
                  ),
                  limit: usage.characterLimit,
                })}
              </Text>
            ) : null}
            <Button
              title={
                checking
                  ? getString('translation.settings.checking')
                  : getString('translation.settings.saveKey')
              }
              onPress={saveKey}
              disabled={checking}
              mode="contained"
            />
            {apiKey ? (
              <Button
                title={getString('translation.settings.clearKey')}
                onPress={removeKey}
                disabled={checking}
              />
            ) : null}
          </View>
          <List.InfoItem
            title={getString('translation.settings.apiKeyInfo')}
            theme={theme}
          />
        </List.Section>
      </View>
    </SafeAreaView>
  );
};

export default SettingsTranslationScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingVertical: 8,
  },
  form: {
    paddingHorizontal: 16,
    gap: 12,
  },
  input: {
    height: 48,
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 16,
    fontSize: 16,
  },
  message: {
    fontSize: 14,
  },
});
