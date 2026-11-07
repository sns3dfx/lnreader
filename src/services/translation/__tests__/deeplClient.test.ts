import {
  TranslationError,
  checkDeepLKey,
  getDeepLBaseUrl,
  listDeepLLanguages,
  translateTexts,
  upsertGlossaryDictionary,
} from '../deeplClient';

const fetchMock = jest.fn();
global.fetch = fetchMock as unknown as typeof fetch;

const jsonResponse = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const lastCall = () => {
  const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  return {
    url: url as string,
    init,
    body: init.body ? JSON.parse(init.body) : undefined,
  };
};

const KEY = 'fake-key:fx';

beforeEach(() => fetchMock.mockReset());

describe('getDeepLBaseUrl', () => {
  it('routes :fx keys to the free host', () => {
    expect(getDeepLBaseUrl('abc:fx')).toBe('https://api-free.deepl.com');
    expect(getDeepLBaseUrl('abc')).toBe('https://api.deepl.com');
  });
});

describe('error mapping', () => {
  it.each([
    [403, 'invalid_key'],
    [456, 'quota_exceeded'],
    [429, 'rate_limited'],
    [500, 'unknown'],
  ])('maps HTTP %i to %s', async (status, code) => {
    fetchMock.mockResolvedValue(jsonResponse({}, status));
    await expect(
      translateTexts(KEY, { texts: ['a'], targetLang: 'en' }),
    ).rejects.toMatchObject({ code });
  });

  it('maps 404 to glossary_missing only when a glossary was sent', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 404));
    await expect(
      translateTexts(KEY, { texts: ['a'], targetLang: 'en', glossaryId: 'g' }),
    ).rejects.toMatchObject({ code: 'glossary_missing' });
    await expect(
      translateTexts(KEY, { texts: ['a'], targetLang: 'en' }),
    ).rejects.toMatchObject({ code: 'unknown' });
  });

  it('maps a rejected fetch to network', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    await expect(checkDeepLKey(KEY)).rejects.toBeInstanceOf(TranslationError);
    await expect(checkDeepLKey(KEY)).rejects.toMatchObject({ code: 'network' });
  });

  it('does not leak the key into error messages', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 403));
    const error = await checkDeepLKey(KEY).catch(e => e);
    expect(error.message).not.toContain(KEY);
  });
});

describe('checkDeepLKey', () => {
  it('reads usage with the auth header', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ character_count: 5, character_limit: 500000 }),
    );
    await expect(checkDeepLKey(KEY)).resolves.toEqual({
      characterCount: 5,
      characterLimit: 500000,
    });
    const { url, init } = lastCall();
    expect(url).toBe('https://api-free.deepl.com/v2/usage');
    expect(init.headers.Authorization).toBe(`DeepL-Auth-Key ${KEY}`);
  });
});

describe('listDeepLLanguages', () => {
  it('maps the v3 languages response', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse([
        {
          lang: 'en',
          name: 'English',
          usable_as_source: true,
          usable_as_target: false,
        },
      ]),
    );
    await expect(listDeepLLanguages(KEY)).resolves.toEqual([
      { code: 'en', name: 'English', source: true, target: false },
    ]);
    expect(lastCall().url).toBe(
      'https://api-free.deepl.com/v3/languages?resource=translate_text',
    );
  });
});

describe('translateTexts', () => {
  const ok = (texts: string[]) =>
    fetchMock.mockResolvedValue(
      jsonResponse({ translations: texts.map(text => ({ text })) }),
    );

  it('sends uppercase langs, tag_handling html and glossary_id', async () => {
    ok(['x']);
    await expect(
      translateTexts(KEY, {
        texts: ['a'],
        sourceLang: 'ja',
        targetLang: 'ru',
        glossaryId: 'gid',
      }),
    ).resolves.toEqual(['x']);
    const { url, init, body } = lastCall();
    expect(url).toBe('https://api-free.deepl.com/v2/translate');
    expect(init.method).toBe('POST');
    expect(body).toMatchObject({
      text: ['a'],
      source_lang: 'JA',
      target_lang: 'RU',
      tag_handling: 'html',
      glossary_id: 'gid',
    });
  });

  it('omits source_lang when sourceLang is auto', async () => {
    ok(['x']);
    await translateTexts(KEY, {
      texts: ['a'],
      sourceLang: 'auto',
      targetLang: 'ru',
    });
    expect(lastCall().body).not.toHaveProperty('source_lang');
    expect(lastCall().body).not.toHaveProperty('glossary_id');
  });

  it('rejects with empty_result when fewer translations return than were sent', async () => {
    ok(['x']);
    await expect(
      translateTexts(KEY, { texts: ['a', 'b'], targetLang: 'ru' }),
    ).rejects.toMatchObject({ code: 'empty_result' });
  });

  it('rejects with empty_result when any translation is blank', async () => {
    ok(['x', '  ']);
    await expect(
      translateTexts(KEY, { texts: ['a', 'b'], targetLang: 'ru' }),
    ).rejects.toMatchObject({ code: 'empty_result' });
  });
});

describe('upsertGlossaryDictionary', () => {
  it('creates a glossary with lowercase langs and tsv entries when no id exists', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ glossary_id: 'new' }, 201));
    await expect(
      upsertGlossaryDictionary(KEY, {
        name: 'book',
        sourceLang: 'JA',
        targetLang: 'RU',
        tsv: 'a\tb',
      }),
    ).resolves.toBe('new');
    const { url, init, body } = lastCall();
    expect(url).toBe('https://api-free.deepl.com/v3/glossaries');
    expect(init.method).toBe('POST');
    expect(body).toEqual({
      name: 'book',
      dictionaries: [
        {
          source_lang: 'ja',
          target_lang: 'ru',
          entries: 'a\tb',
          entries_format: 'tsv',
        },
      ],
    });
  });

  it('replaces the dictionary when an id exists', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 200));
    await expect(
      upsertGlossaryDictionary(KEY, {
        glossaryId: 'gid',
        name: 'book',
        sourceLang: 'ja',
        targetLang: 'ru',
        tsv: 'a\tb',
      }),
    ).resolves.toBe('gid');
    const { url, init, body } = lastCall();
    expect(url).toBe(
      'https://api-free.deepl.com/v3/glossaries/gid/dictionaries',
    );
    expect(init.method).toBe('PUT');
    expect(body).toEqual({
      source_lang: 'ja',
      target_lang: 'ru',
      entries: 'a\tb',
      entries_format: 'tsv',
    });
  });
});
