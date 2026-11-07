import React, { useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { overlay } from 'react-native-paper';
import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';

import { ThemeColors } from '@theme/types';
import { getString } from '@i18n/translations';
import { useBoolean } from '@hooks/index';
import { Menu } from '@components';
import type { ChapterTranslationState } from '@screens/novel/hooks/useChapterTranslations';

interface TranslateButtonProps {
  state: ChapterTranslationState;
  theme: ThemeColors;
  translate: () => void;
  retranslate: () => void;
  deleteTranslation: () => void;
}

export const TranslateButton: React.FC<TranslateButtonProps> = ({
  state,
  theme,
  translate,
  retranslate,
  deleteTranslation,
}) => {
  const {
    value: menuVisible,
    setTrue: showMenu,
    setFalse: hideMenu,
  } = useBoolean();

  const menuContentStyle = useMemo(
    () => ({ backgroundColor: overlay(2, theme.surface) }),
    [theme.surface],
  );
  const menuTitleStyle = useMemo(
    () => ({ color: theme.onSurface }),
    [theme.onSurface],
  );

  if (state === 'translating') {
    return (
      <View style={styles.container} testID="translate-spinner">
        <ActivityIndicator
          color={theme.outline}
          size={25}
          style={styles.activityIndicator}
        />
      </View>
    );
  }

  if (state === 'saved') {
    return (
      <Menu
        visible={menuVisible}
        onDismiss={hideMenu}
        anchor={
          <TranslateIconButton
            theme={theme}
            color={theme.primary}
            onPress={showMenu}
          />
        }
        contentStyle={menuContentStyle}
      >
        <Menu.Item
          onPress={() => {
            retranslate();
            hideMenu();
          }}
          title={getString('translation.chapter.retranslate')}
          titleStyle={menuTitleStyle}
        />
        <Menu.Item
          onPress={() => {
            deleteTranslation();
            hideMenu();
          }}
          title={getString('translation.chapter.deleteTranslation')}
          titleStyle={menuTitleStyle}
        />
      </Menu>
    );
  }

  return (
    <TranslateIconButton
      theme={theme}
      color={theme.outline}
      onPress={translate}
    />
  );
};

const TranslateIconButton: React.FC<{
  theme: ThemeColors;
  color: string;
  onPress: () => void;
}> = ({ theme, color, onPress }) => (
  <View style={styles.container}>
    <Pressable
      style={styles.pressable}
      onPress={onPress}
      accessibilityLabel={getString('translation.chapter.translate')}
      android_ripple={{ color: theme.rippleColor }}
    >
      <MaterialCommunityIcons name="translate" size={25} color={color} />
    </Pressable>
  </View>
);

const styles = StyleSheet.create({
  activityIndicator: { margin: 3.5, padding: 5 },
  container: {
    borderRadius: 50,
    width: 40,
    height: 40,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressable: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
