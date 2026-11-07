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

describe('request timeout', () => {
  const abortRejection = (signal: AbortSignal) =>
    new Promise<never>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('Aborted')));
    });

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('aborts a stalled connection after 60 seconds as network', async () => {
    fetchMock.mockImplementation((_url, init) => abortRejection(init.signal));

    const outcome = translateTexts(KEY, {
      texts: ['a'],
      targetLang: 'en',
    }).catch(e => e);

    await jest.advanceTimersByTimeAsync(59999);
    expect(lastCall().init.signal.aborted).toBe(false);

    await jest.advanceTimersByTimeAsync(1);
    expect(lastCall().init.signal.aborted).toBe(true);
    await expect(outcome).resolves.toBeInstanceOf(TranslationError);
    await expect(outcome).resolves.toMatchObject({ code: 'network' });
  });

  it('reports a body that stalls past the timeout as network', async () => {
    fetchMock.mockImplementation(async (_url, init) => ({
      ok: true,
      status: 200,
      json: () => abortRejection(init.signal),
    }));

    const outcome = checkDeepLKey(KEY).catch(e => e);

    await jest.advanceTimersByTimeAsync(60000);
    await expect(outcome).resolves.toMatchObject({ code: 'network' });
  });

  it('leaves no timer behind once a request settles', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 403));
    await checkDeepLKey(KEY).catch(() => undefined);
    expect(jest.getTimerCount()).toBe(0);

    fetchMock.mockResolvedValue(
      jsonResponse({ character_count: 1, character_limit: 2 }),
    );
    await checkDeepLKey(KEY);
    expect(jest.getTimerCount()).toBe(0);
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

  it.each([
    ['a captive portal page', undefined],
    ['null', null],
    ['an object without usage fields', { message: 'welcome' }],
    ['a missing limit', { character_count: 5 }],
    ['a missing count', { character_limit: 500000 }],
    [
      'usage fields that are not numbers',
      { character_count: '5', character_limit: '500000' },
    ],
  ])('rejects a 2xx with %s as unknown', async (_name, body) => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        if (body === undefined) {
          throw new SyntaxError('Unexpected token <');
        }
        return body;
      },
    });
    const error = await checkDeepLKey(KEY).catch(e => e);
    expect(error).toBeInstanceOf(TranslationError);
    expect(error.code).toBe('unknown');
  });

  it('accepts a zero usage count', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ character_count: 0, character_limit: 500000 }),
    );
    await expect(checkDeepLKey(KEY)).resolves.toEqual({
      characterCount: 0,
      characterLimit: 500000,
    });
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

  describe('HTTP errors', () => {
    const upsert = (glossaryId?: string) =>
      upsertGlossaryDictionary(KEY, {
        glossaryId,
        name: 'book',
        sourceLang: 'ja',
        targetLang: 'ru',
        tsv: 'a\tb',
      });

    it('creates a new glossary when the stored one is gone', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({}, 404))
        .mockResolvedValueOnce(jsonResponse({ glossary_id: 'new' }, 201));

      await expect(upsert('dead')).resolves.toBe('new');

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0][1].method).toBe('PUT');
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

    it('reports the failure of the fallback that creates the glossary', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({}, 404))
        .mockResolvedValueOnce(jsonResponse({}, 456));

      await expect(upsert('dead')).rejects.toMatchObject({
        code: 'quota_exceeded',
      });
    });

    it.each([
      [403, 'invalid_key'],
      [429, 'rate_limited'],
      [456, 'quota_exceeded'],
      [500, 'unknown'],
    ])('does not create a glossary after a PUT %i', async (status, code) => {
      fetchMock.mockResolvedValue(jsonResponse({}, status));

      await expect(upsert('gid')).rejects.toMatchObject({ code });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it.each([
      [403, 'invalid_key'],
      [404, 'unknown'],
      [429, 'rate_limited'],
      [456, 'quota_exceeded'],
      [500, 'unknown'],
    ])('maps a POST %i to %s', async (status, code) => {
      fetchMock.mockResolvedValue(jsonResponse({}, status));

      await expect(upsert()).rejects.toMatchObject({ code });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('does not create a glossary after a network failure', async () => {
      fetchMock.mockRejectedValue(new Error('offline'));

      await expect(upsert('gid')).rejects.toMatchObject({ code: 'network' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
