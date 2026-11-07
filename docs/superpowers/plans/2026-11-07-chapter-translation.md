# Chapter Translation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Переводить отдельные главы из любого источника через DeepL со словарём, сохранять перевод на телефоне и переключать оригинал и перевод в читалке.

**Architecture:** Новый сервис `src/services/translation` не зависит от UI: клиент DeepL, разбор словаря, хранение и сборка перевода главы. Читалка подключает его в `useChapter`, список глав — через хук `useChapterTranslations`. Переводы лежат отдельным JSON на главу и пару языков в папке книги.

**Tech Stack:** React Native (Expo), TypeScript, zustand, MMKV, `@modules/native-file`, Jest + `@testing-library/react-native`, DeepL API.

**Spec:** `docs/superpowers/specs/2026-11-07-chapter-translation-design.md`

## Global Constraints

- Работать в worktree на ветке `feat/chapter-translation` от `master`: в основной папке есть чужие незакоммиченные правки, в том числе в `strings.json` и `src/i18n/types/index.ts`.
- Перевод только по запросу: открытая глава при включённом режиме или нажатая кнопка. Следующая глава заранее не переводится.
- Перевод никогда не заменяет исходный текст и не пишется в `chapterTextCache`.
- Подстановки терминов на стороне приложения нет, словарь применяет только DeepL.
- Ключ хранится в MMKV под `DEEPL_API_KEY` и не попадает в резервную копию.
- Ключ `:fx` → `https://api-free.deepl.com`, иначе `https://api.deepl.com`.
- Запрос перевода: `POST /v2/translate`, `tag_handling: "html"`, обычный текст, не файл.
- Без настроенного перевода поведение приложения не меняется.
- Строки только в `src/i18n/languages/en/strings.json`, затем `pnpm run generate:string-types`.
- `no-console`: сообщения через `showToast`. Импорты через алиасы (`@services/*`, `@utils/*` и другие).
- Перед завершением: `pnpm run check` и `pnpm test`.
- Коммиты заканчиваются строкой `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Двойное нажатие на кнопку, или одновременно список и читалка: один запрос к DeepL на главу и пару языков, а не два.
2. Пользователь ушёл на другую главу, пока шёл перевод: старый результат сохраняется, но не появляется на экране новой главы.
3. Часть ответа DeepL пустая или частей меньше, чем отправлено: ничего не сохраняется, лимит на повтор не тратится молча.
4. Глава переведена в читалке, пользователь вернулся в список: кнопка показывает «сохранено» без перезапуска.
5. Глава длиннее лимита запроса: части склеиваются по порядку, тег не разрывается, картинки сохраняют `src`.

---

### Task 1: Клиент DeepL

**Files:**

- Create: `src/services/translation/deeplClient.ts`
- Test: `src/services/translation/__tests__/deeplClient.test.ts`

**Interfaces:**

- Produces:

  - `type TranslationErrorCode = 'invalid_key' | 'quota_exceeded' | 'rate_limited' | 'glossary_missing' | 'network' | 'empty_result' | 'unknown'`
  - `class TranslationError extends Error { code: TranslationErrorCode }`
  - `interface DeepLLanguage { code: string; name: string; source: boolean; target: boolean }`
  - `getDeepLBaseUrl(apiKey: string): string`
  - `checkDeepLKey(apiKey: string): Promise<{ characterCount: number; characterLimit: number }>` — `GET /v2/usage`
  - `listDeepLLanguages(apiKey: string): Promise<DeepLLanguage[]>` — `GET /v3/languages?resource=translate_text`; ответ — массив `{ lang, name, usable_as_source, usable_as_target }`
  - `translateTexts(apiKey: string, request: { texts: string[]; sourceLang?: string; targetLang: string; glossaryId?: string }): Promise<string[]>`
  - `upsertGlossaryDictionary(apiKey: string, request: { glossaryId?: string; name: string; sourceLang: string; targetLang: string; tsv: string }): Promise<string>` — возвращает id словаря

- [ ] **Step 1: Write the failing tests**

Мокать `global.fetch`. Обязательные случаи:

```ts
it('routes :fx keys to the free host', () => {
  expect(getDeepLBaseUrl('abc:fx')).toBe('https://api-free.deepl.com');
  expect(getDeepLBaseUrl('abc')).toBe('https://api.deepl.com');
});
it.each([
  [403, 'invalid_key'], [456, 'quota_exceeded'], [429, 'rate_limited'],
])('maps HTTP %i to %s', async (status, code) => { /* rejects with that code */ });
it('maps 404 to glossary_missing only when a glossary was sent', ...);
it('maps a rejected fetch to network', ...);
it('rejects with empty_result when fewer translations return than were sent', ...);
it('rejects with empty_result when any translation is blank', ...);
it('sends uppercase langs, tag_handling html and glossary_id', ...);
it('omits source_lang when sourceLang is auto', ...);
it('creates a glossary with lowercase langs and tsv entries when no id exists', ...); // POST /v3/glossaries
it('replaces the dictionary when an id exists', ...); // PUT /v3/glossaries/{id}/dictionaries
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec jest --selectProjects rn src/services/translation/__tests__/deeplClient.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/services/translation/deeplClient.ts`**

Авторизация: `Authorization: DeepL-Auth-Key <key>`. `sourceLang === 'auto'` или пустой значит не передавать `source_lang`. Статусы проверены на живом API: неверный ключ 403, несуществующий словарь 404. Ключ не попадает в текст ошибок.

- [ ] **Step 4: Run to verify pass**

Run: та же команда. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/translation
git commit -m "feat: Add DeepL Client For Chapter Translation"
```

---

### Task 2: Файл словаря и хранение переводов

**Files:**

- Create: `src/services/translation/glossaryFile.ts`
- Create: `src/services/translation/translationStorage.ts`
- Test: `src/services/translation/__tests__/glossaryFile.test.ts`
- Test: `src/services/translation/__tests__/translationStorage.test.ts`

**Interfaces:**

- Produces:

  - `class GlossaryFileError extends Error { code: 'empty' | 'bad_line' | 'duplicate'; line?: number }`
  - `parseGlossaryTsv(content: string): { entryCount: number; tsv: string }`
  - `interface SavedTranslation { html: string; title: string; glossaryId?: string; createdAt: string }`
  - `interface TranslationRef { pluginId: string; novelId: number; chapterId: number; sourceLang: string; targetLang: string }`
  - `readTranslation(ref: TranslationRef): Promise<SavedTranslation | undefined>`
  - `writeTranslation(ref: TranslationRef, value: SavedTranslation): Promise<void>`
  - `deleteTranslation(ref: TranslationRef): Promise<void>`
  - `listTranslatedChapterIds(pluginId: string, novelId: number, sourceLang: string, targetLang: string): Promise<Set<number>>`

- [ ] **Step 1: Write the failing tests**

```ts
it('accepts BOM, CRLF and blank lines', () => {
  expect(parseGlossaryTsv('﻿白雾\tБай У\r\n\r\n高塔\tБашня\r\n'))
    .toEqual({ entryCount: 2, tsv: '白雾\tБай У\n高塔\tБашня' });
});
it('rejects a duplicate source term with its line', ...);   // code 'duplicate', line 2
it('rejects a line without two columns', ...);              // code 'bad_line'
it('rejects a file with no entries', ...);                  // code 'empty'

it('stores under the novel translations folder, keyed by chapter and language pair', ...);
// path: `${NOVEL_STORAGE}/${pluginId}/${novelId}/translations/${chapterId}.${sourceLang}-${targetLang}.json`
it('writes to a temp file and moves it into place', ...);
it('returns undefined when the file is missing or corrupt', ...);
it('lists only ids for the requested language pair', ...);
it('returns an empty set when the folder does not exist', ...);
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec jest --selectProjects rn src/services/translation/__tests__/glossaryFile.test.ts src/services/translation/__tests__/translationStorage.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement both modules**

Папка `translations` намеренно лежит рядом с папками глав: `deleteChapter` её не трогает, удаление книги её удаляет, а `restoreNovelFiles` пропускает папки, которых нет в карте глав, поэтому после восстановления переводы теряются. Это принятая спецификацией потеря. Запись атомарная: `writeFile` во временный файл, затем `NativeFile.moveFile`.

- [ ] **Step 4: Run to verify pass**

Run: та же команда. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/translation
git commit -m "feat: Add Glossary Parsing And Translation Storage"
```

---

### Task 3: Перевод главы

**Files:**

- Create: `src/services/translation/translateChapter.ts`
- Test: `src/services/translation/__tests__/translateChapter.test.ts`

**Interfaces:**

- Consumes: `translateTexts`, `TranslationError`, `readTranslation`, `writeTranslation`, `SavedTranslation`, `fetchChapter` из `@services/plugin/fetch`.
- Produces:

  - `splitChapterHtml(html: string, maxChars?: number): string[]`, по умолчанию `maxChars = 30000` (лимит DeepL 128 KiB, до 3 байт на символ, плюс запас)
  - `translateChapter(params: { apiKey: string; pluginId: string; novelId: number; chapter: { id: number; path: string; name: string }; sourceLang: string; targetLang: string; glossaryId?: string; force?: boolean }): Promise<SavedTranslation>`

- [ ] **Step 1: Write the failing tests**

```ts
it('returns a saved translation without calling DeepL', ...);
it('calls DeepL when force is true', ...);
it('sends the title first and the chapter parts after it', ...);
it('joins long chapters in order and keeps img src', ...);          // Review Focus 5
it('never splits inside a tag', ...);                               // Review Focus 5
it('shares one request between concurrent calls for the same chapter and pair', ...); // Review Focus 1
it('runs separately for a different language pair', ...);
it('saves nothing when DeepL returns empty_result', ...);           // Review Focus 3
it('rejects with empty_result and no DeepL call when the source is empty', ...);
it('records the glossary id', ...);
it('reads the downloaded file before asking the plugin', ...);
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec jest --selectProjects rn src/services/translation/__tests__/translateChapter.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `translateChapter.ts`**

Источник читается как в `loadChapterText`: файл `index.html`, затем `fetchChapter`. `splitChapterHtml` режет по границам элементов верхнего уровня через `cheerio`, элемент длиннее лимита остаётся целой частью. Текущие запросы лежат в `Map`, ключ `${chapterId}:${sourceLang}-${targetLang}`, запись удаляется в `finally`.

- [ ] **Step 4: Run to verify pass**

Run: та же команда. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/translation
git commit -m "feat: Translate And Store Chapters"
```

---

### Task 4: Ключ DeepL и экран настроек

**Files:**

- Create: `src/hooks/persisted/useDeepLKey.ts`
- Create: `src/services/translation/translationErrorMessage.ts`
- Create: `src/screens/settings/SettingsTranslationScreen.tsx`
- Modify: `src/services/backup/utils.ts` (`backupMMKVData`, `excludeKeys`)
- Modify: `src/navigators/types/index.ts` (`SettingsStackParamList`: `TranslationSettings: undefined`)
- Modify: `src/navigators/SettingsStack.tsx`
- Modify: `src/screens/settings/SettingsScreen.tsx`
- Modify: `src/i18n/languages/en/strings.json`, затем `src/i18n/types/index.ts` генерацией
- Test: `src/services/backup/__tests__/backupKeys.test.ts` (для этого экспортировать `backupMMKVData`)
- Test: `src/screens/settings/__tests__/SettingsTranslationScreen.test.tsx`

**Interfaces:**

- Consumes: `checkDeepLKey`, `TranslationError`.
- Produces:

  - `DEEPL_API_KEY = 'DEEPL_API_KEY'`
  - `getDeepLApiKey(): string | undefined`
  - `useDeepLKey(): { apiKey: string | undefined; setApiKey: (key: string) => void; clearApiKey: () => void }`
  - `translationErrorMessage(code: TranslationErrorCode): string` в `src/services/translation/translationErrorMessage.ts`
  - Строки: `translation.errors.{invalidKey,quotaExceeded,rateLimited,glossaryMissing,network,emptyResult,unknown}`, `translation.settings.*`

- [ ] **Step 1: Write the failing tests**

```ts
it('never includes the DeepL key in a backup', ...);
it('saves a key only after DeepL accepts it', ...);
it('shows the invalid key message and keeps the old key on 403', ...);
it('shows remaining characters after a successful check', ...);
it('clears the key', ...);
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec jest --selectProjects rn src/screens/settings/__tests__/SettingsTranslationScreen.test.tsx src/services/backup`
Expected: FAIL.

- [ ] **Step 3: Implement**

Поле ключа скрывает значение. Экран повторяет стиль `SettingsTrackerScreen.tsx`. Значение ключа нигде не логируется.

- [ ] **Step 4: Generate strings and run tests**

Run: `pnpm run generate:string-types && pnpm exec jest --selectProjects rn src/screens/settings/__tests__/SettingsTranslationScreen.test.tsx src/services/backup`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "feat: Add DeepL Key Settings Excluded From Backups"
```

---

### Task 5: Настройки перевода книги

**Files:**

- Modify: `src/hooks/persisted/useNovel/types.ts` (`NovelSettingsWithoutSort.translation?`)
- Modify: `src/hooks/persisted/useNovelSettings.ts`
- Create: `src/screens/novel/components/TranslationSettingsModal.tsx`
- Create: `src/services/translation/translationSettings.ts`
- Modify: `src/screens/novel/components/NovelAppbar.tsx` (`extraMenuItems`)
- Modify: родитель `NovelAppbar`, который держит модальные окна
- Modify: `src/i18n/languages/en/strings.json`
- Test: `src/screens/novel/components/__tests__/TranslationSettingsModal.test.tsx`

**Interfaces:**

- Consumes: `listDeepLLanguages`, `upsertGlossaryDictionary`, `parseGlossaryTsv`, `GlossaryFileError`, `useDeepLKey`, `translationErrorMessage`.
- Produces:

  - ```ts
    interface NovelTranslationSettings {
      sourceLang: string; // код DeepL в нижнем регистре или 'auto'
      targetLang: string; // код DeepL в нижнем регистре
      showTranslation: boolean;
      glossaryId?: string; // один словарь на книгу
      glossaries: Record<string, { entryCount: number }>; // ключ `${source}-${target}`
    }
    ```
  - `useNovelSettings()` дополнительно отдаёт `translation` и `setTranslation(next: Partial<NovelTranslationSettings>)`
  - `getGlossaryIdForPair(settings: NovelTranslationSettings): string | undefined` в `src/services/translation/translationSettings.ts`
  - `<TranslationSettingsModal visible onDismiss theme />`

- [ ] **Step 1: Write the failing tests**

```ts
it('shows source and target languages from DeepL', ...);
it('uploads a glossary file and shows the entry count', ...);
it('shows the parse error and sends nothing for a bad file', ...);
it('disables glossary upload while the source language is auto', ...);
it('reuses the existing glossary id for a second language pair', ...);
it('shows a hint to add the key when none is set', ...);
it('returns no glossary id for a pair without a dictionary', ...); // решение 8 спецификации
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec jest --selectProjects rn src/screens/novel/components/__tests__/TranslationSettingsModal.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Файл выбирается через `expo-document-picker`, как в `CodeSnippetsScreen.tsx`, и читается через `NativeFile.readFile`. Пункт меню добавляется в `extraMenuItems` только для нелокальных книг. Если `translation` не задан, в книге ничего не меняется.

- [ ] **Step 4: Run to verify pass**

Run: та же команда. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "feat: Add Per Novel Translation Settings And Glossary Upload"
```

---

### Task 6: Читалка

**Files:**

- Modify: `src/screens/reader/hooks/useChapter.ts`
- Modify: `src/screens/reader/components/ReaderAppbar.tsx`
- Modify: `src/components/IconButtonV2/IconButtonV2.tsx` (добавить `onLongPress?`)
- Modify: `src/screens/reader/components/WebViewReader.tsx` (`case 'next'`)
- Modify: `src/i18n/languages/en/strings.json`
- Test: `src/screens/reader/hooks/__tests__/useChapter.test.ts`
- Test: `src/screens/reader/components/__tests__/ReaderAppbar.test.tsx`

**Interfaces:**

- Consumes: `translateChapter`, `readTranslation`, `getGlossaryIdForPair`, `getDeepLApiKey`, `translationErrorMessage`, `TranslationSettingsModal`, `setTranslation`.
- Produces в `chapterContext`:

  - `translating: boolean`
  - `showingTranslation: boolean`
  - `translationAvailable: boolean` — есть ключ или сохранённый перевод текущей главы
  - `translatedTitle: string | undefined`
  - `toggleTranslation: () => void`
  - `canAutoAdvance: () => Promise<boolean>`

- [ ] **Step 1: Write the failing tests**

```ts
it('shows the original when translation is not configured', ...);
it('shows a saved translation without a key and without calling DeepL', ...);
it('translates the opened chapter when the mode is on', ...);
it('falls back to the original and shows the error message on failure', ...);
it('does not cache an error as a translation', ...);
it('never translates the prefetched next chapter', ...);
it('keeps the original in chapterTextCache while a translation is shown', ...);
it('toggles back to the original without a DeepL call', ...);
it('stores the mode for the novel so the next chapter opens the same way', ...);
it('ignores a finished translation after the reader moved on', ...);   // Review Focus 2
it('stops on a missing glossary without spending quota on a retry', ...);
it('blocks auto advance to an untranslated chapter in translation mode', ...);
it('allows auto advance to a saved translation', ...);
it('allows auto advance when the mode is off', ...);
// ReaderAppbar
it('hides the button when translation is unavailable', ...);
it('toggles on press and opens language settings on long press', ...);
it('opens language settings when no languages are set', ...);
it('shows a spinner while translating', ...);
it('shows the translated title', ...);
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec jest --selectProjects rn src/screens/reader`
Expected: FAIL on the new tests.

- [ ] **Step 3: Implement `useChapter.ts`**

`loadChapterHtml` и `prefetchChapter` не меняются, поэтому заранее переводить нечему. В `getChapter` после получения оригинала, если `translationRef.current?.showTranslation`:

1. `readTranslation`; если есть, показать его через `sanitizeChapterText`.
2. Иначе, если есть ключ, вызвать `translateChapter` с `getGlossaryIdForPair`.
3. Ключа нет: показать оригинал без сообщения.
4. Ошибка: `showToast(translationErrorMessage(code))`, показать оригинал.

Проверка `isStale()` идёт после каждого `await`. `translationRef` обновляется по образцу `excludedScanlatorsRef`, чтобы `getChapter` оставался стабильным. При открытии главы показывается обычный экран загрузки. При переключении в читалке старый текст остаётся до готовности, а панель показывает индикатор.

`canAutoAdvance`: `true`, если режим выключен, следующей главы нет или её перевод сохранён.

- [ ] **Step 4: Implement UI and auto advance**

В `ReaderAppbar` кнопка стоит перед поиском: иконка `translate`, цвет `theme.primary`, когда показан перевод, и `ActivityIndicator` при `translating`. Подзаголовок: `translatedTitle ?? chapter.name`. В `WebViewReader`, `case 'next'` с `event.autoStartTTS`: если `canAutoAdvance()` вернул `false`, показать сообщение, выполнить `window.tts?.stop?.(); true;` и не переходить.

- [ ] **Step 5: Run to verify pass**

Run: `pnpm run generate:string-types && pnpm exec jest --selectProjects rn src/screens/reader src/components`
Expected: PASS, существующие тесты читалки тоже.

- [ ] **Step 6: Commit**

```bash
git add src
git commit -m "feat: Add Translation Toggle To The Reader"
```

---

### Task 7: Кнопка перевода в списке глав

**Files:**

- Create: `src/screens/novel/hooks/useChapterTranslations.ts`
- Create: `src/screens/novel/components/Chapter/ChapterTranslateButton.tsx`
- Modify: `src/screens/novel/components/ChapterItem.tsx`
- Modify: `src/screens/novel/components/NovelScreenList.tsx`
- Modify: `src/screens/novel/components/NovelChapterGroup.tsx`
- Modify: `src/i18n/languages/en/strings.json`
- Test: `src/screens/novel/hooks/__tests__/useChapterTranslations.test.ts`
- Test: `src/screens/novel/components/__tests__/ChapterTranslateButton.test.tsx`

**Interfaces:**

- Consumes: `translateChapter`, `deleteTranslation`, `listTranslatedChapterIds`, `getGlossaryIdForPair`, `getDeepLApiKey`, `translationErrorMessage`, `useNovelSettings().translation`.
- Produces:

  - `type ChapterTranslationState = 'none' | 'translating' | 'saved'`
  - `useChapterTranslations(): { getState: (chapterId: number) => ChapterTranslationState | undefined; translate: (chapter: ChapterInfo) => void; retranslate: (chapter: ChapterInfo) => void; remove: (chapter: ChapterInfo) => void }`
  - `getState` возвращает `undefined`, когда кнопку показывать не надо: языки не заданы, или нет ключа и нет сохранённого перевода.
  - `ChapterItem`: новые свойства `translationState?: ChapterTranslationState`, `onTranslateChapter`, `onRetranslateChapter`, `onDeleteTranslation`.

- [ ] **Step 1: Write the failing tests**

```ts
it('hides the button until languages are set', ...);
it('shows saved chapters after loading the folder', ...);
it('translates queued chapters one at a time', ...);
it('marks a chapter saved after success', ...);
it('returns to none and shows the message on failure', ...);
it('refreshes saved chapters when the screen regains focus', ...); // Review Focus 4
it('retranslate passes force', ...);
it('removes a saved translation', ...);
it('keeps the saved state for a chapter without a key', ...);
// кнопка
it('starts a translation from the none state', ...);
it('shows a spinner and ignores presses while translating', ...);
it('opens a menu with retranslate and delete when saved', ...);
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec jest --selectProjects rn src/screens/novel/hooks/__tests__/useChapterTranslations.test.ts src/screens/novel/components/__tests__/ChapterTranslateButton.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Кнопка стоит перед `DownloadButton` и построена как он: тот же размер, `Menu` для сохранённого состояния, иконка `translate`. Для локальных книг кнопки нет. `ChapterItem` получает готовое значение состояния, чтобы `memo` не перерисовывал весь список.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm run generate:string-types && pnpm exec jest --selectProjects rn src/screens/novel`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "feat: Add Chapter Translate Button To The Chapter List"
```

---

### Task 8: Словарь этой книги

Задача вне кода приложения: файлы не коммитятся, скрипты остаются во временной папке.

**Files:**

- Create: `doomsday-jigsaw-zh-ru.tsv` вне репозитория, затем на телефон в `/sdcard/Download/`

- [ ] **Step 1: Собрать имена**

Использовать метод из раздела «Словарь этой книги» спецификации: китайские сочетания, запись по Палладию, поиск в 901 русской главе. Для китайских глав брать равномерную выборку из Quanben с паузой не меньше секунды между запросами.

- [ ] **Step 2: Собрать термины**

Сопоставить частые термины книги по параллельным отрывкам. Обязательно проверить: 高塔 → Башня, 调查军团 → Расследовательский корпус, 恶堕, 塔外, 五九 → У Цзю. Написание брать только из русского текста.

- [ ] **Step 3: Отсеять ложные записи**

Убрать обычные слова и хвосты имён: 研究, 轻易, 理智, 雾就. Лучше пропустить запись, чем добавить ложную. Итог не больше 1000 записей.

- [ ] **Step 4: Проверить файл**

`parseGlossaryTsv` принимает файл. На настоящем ключе, на отрывках глав 1, 23 и 500, в переводе нет «Бэй Ву» и «Белого Тумана».

- [ ] **Step 5: Положить на телефон**

Run: `adb -s 4B151FDAS001PT push doomsday-jigsaw-zh-ru.tsv /sdcard/Download/`
Expected: `1 file pushed`.

---

### Task 9: Итоговая проверка

**Files:** без новых файлов.

- [ ] **Step 1: Полная проверка**

Run: `pnpm run check && pnpm test`
Expected: всё зелёное. Если падает, исправить в задаче, которой это принадлежит.

- [ ] **Step 2: Ручная проверка на Pixel `4B151FDAS001PT`**

Собрать приложение по `CONTRIBUTING.md`. Сценарий:

1. Ввести новый ключ в настройках.
2. Добавить книгу из Quanben, задать китайский → русский, загрузить словарь.
3. Перевести главу 1 кнопкой в списке, открыть её и переключить туда-обратно.
4. Открыть главу 23 с включённым режимом: перевод появился, имена из словаря.
5. Вернуться в список: у главы 23 состояние «сохранено».
6. Отключить сеть и открыть непереведённую главу: виден оригинал и сообщение.
7. Включить озвучку с автопереходом на главе перед непереведённой: озвучка остановилась, символы не потрачены.
8. Удалить загрузку главы: перевод остался.

- [ ] **Step 3: Создать резервную копию и проверить, что в ней нет `DEEPL_API_KEY`**

Run: распаковать копию и выполнить `grep -r DEEPL_API_KEY <папка>`.
Expected: нет совпадений.
