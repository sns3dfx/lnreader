export type TranslationErrorCode =
  | 'invalid_key'
  | 'quota_exceeded'
  | 'rate_limited'
  | 'glossary_missing'
  | 'network'
  | 'empty_result'
  | 'unknown';

export class TranslationError extends Error {
  code: TranslationErrorCode;

  constructor(code: TranslationErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'TranslationError';
    this.code = code;
  }
}

export interface DeepLLanguage {
  code: string;
  name: string;
  source: boolean;
  target: boolean;
}

export interface TranslateRequest {
  texts: string[];
  sourceLang?: string;
  targetLang: string;
  glossaryId?: string;
}

export interface GlossaryDictionaryRequest {
  glossaryId?: string;
  name: string;
  sourceLang: string;
  targetLang: string;
  tsv: string;
}

const REQUEST_TIMEOUT_MS = 60000;

export const getDeepLBaseUrl = (apiKey: string): string =>
  apiKey.endsWith(':fx')
    ? 'https://api-free.deepl.com'
    : 'https://api.deepl.com';

const statusToCode = (
  status: number,
  glossarySent: boolean,
): TranslationErrorCode => {
  switch (status) {
    case 403:
      return 'invalid_key';
    case 456:
      return 'quota_exceeded';
    case 429:
      return 'rate_limited';
    case 404:
      return glossarySent ? 'glossary_missing' : 'unknown';
    default:
      return 'unknown';
  }
};

const request = async (
  apiKey: string,
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: unknown,
  glossarySent = false,
): Promise<any> => {
  // RN's OkHttp client has every timeout at 0: a stalled connection never settles.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetch(`${getDeepLBaseUrl(apiKey)}${path}`, {
        method,
        headers: {
          Authorization: `DeepL-Auth-Key ${apiKey}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      throw new TranslationError('network');
    }

    if (!response.ok) {
      throw new TranslationError(
        statusToCode(response.status, glossarySent),
        `DeepL request failed with HTTP ${response.status}`,
      );
    }

    try {
      return await response.json();
    } catch {
      if (controller.signal.aborted) {
        throw new TranslationError('network');
      }
      return {};
    }
  } finally {
    clearTimeout(timeout);
  }
};

export const checkDeepLKey = async (
  apiKey: string,
): Promise<{ characterCount: number; characterLimit: number }> => {
  const data = await request(apiKey, 'GET', '/v2/usage');
  // A captive portal answers 2xx too, and that must not save an unverified key.
  if (
    typeof data?.character_count !== 'number' ||
    typeof data?.character_limit !== 'number'
  ) {
    throw new TranslationError('unknown');
  }
  return {
    characterCount: data.character_count,
    characterLimit: data.character_limit,
  };
};

export const listDeepLLanguages = async (
  apiKey: string,
): Promise<DeepLLanguage[]> => {
  const data = await request(
    apiKey,
    'GET',
    '/v3/languages?resource=translate_text',
  );
  return (Array.isArray(data) ? data : []).map((item: any) => ({
    code: item.lang,
    name: item.name,
    source: !!item.usable_as_source,
    target: !!item.usable_as_target,
  }));
};

export const translateTexts = async (
  apiKey: string,
  { texts, sourceLang, targetLang, glossaryId }: TranslateRequest,
): Promise<string[]> => {
  const hasSource = !!sourceLang && sourceLang.toLowerCase() !== 'auto';
  const data = await request(
    apiKey,
    'POST',
    '/v2/translate',
    {
      text: texts,
      target_lang: targetLang.toUpperCase(),
      tag_handling: 'html',
      ...(hasSource ? { source_lang: sourceLang.toUpperCase() } : {}),
      ...(glossaryId ? { glossary_id: glossaryId } : {}),
    },
    !!glossaryId,
  );

  const translations: string[] = Array.isArray(data?.translations)
    ? data.translations.map((item: any) => item?.text)
    : [];
  if (
    translations.length !== texts.length ||
    translations.some(text => typeof text !== 'string' || !text.trim())
  ) {
    throw new TranslationError('empty_result');
  }
  return translations;
};

export const upsertGlossaryDictionary = async (
  apiKey: string,
  { glossaryId, name, sourceLang, targetLang, tsv }: GlossaryDictionaryRequest,
): Promise<string> => {
  const dictionary = {
    source_lang: sourceLang.toLowerCase(),
    target_lang: targetLang.toLowerCase(),
    entries: tsv,
    entries_format: 'tsv',
  };

  if (glossaryId) {
    try {
      await request(
        apiKey,
        'PUT',
        `/v3/glossaries/${encodeURIComponent(glossaryId)}/dictionaries`,
        dictionary,
        true,
      );
      return glossaryId;
    } catch (e) {
      // Deleted at DeepL: only a new glossary can replace the stored id.
      if (!(e instanceof TranslationError && e.code === 'glossary_missing')) {
        throw e;
      }
    }
  }

  const data = await request(apiKey, 'POST', '/v3/glossaries', {
    name,
    dictionaries: [dictionary],
  });
  if (!data?.glossary_id) {
    throw new TranslationError('unknown');
  }
  return data.glossary_id;
};
