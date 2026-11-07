import { GlossaryFileError, parseGlossaryTsv } from '../glossaryFile';

const catchError = (content: string) => {
  try {
    parseGlossaryTsv(content);
  } catch (e) {
    return e as GlossaryFileError;
  }
  throw new Error('expected parseGlossaryTsv to throw');
};

describe('parseGlossaryTsv', () => {
  it('accepts BOM, CRLF and blank lines', () => {
    expect(parseGlossaryTsv('﻿白雾\tБай У\r\n\r\n高塔\tБашня\r\n')).toEqual({
      entryCount: 2,
      tsv: '白雾\tБай У\n高塔\tБашня',
    });
  });

  it('rejects a duplicate source term with its line', () => {
    const error = catchError('白雾\tБай У\n白雾\tТуман\n');
    expect(error).toBeInstanceOf(GlossaryFileError);
    expect(error.code).toBe('duplicate');
    expect(error.line).toBe(2);
  });

  it('rejects a line without two columns', () => {
    const error = catchError('白雾\tБай У\nнет табуляции\n');
    expect(error.code).toBe('bad_line');
    expect(error.line).toBe(2);
  });

  it('rejects a file with no entries', () => {
    expect(catchError('﻿\r\n\r\n').code).toBe('empty');
  });
});
