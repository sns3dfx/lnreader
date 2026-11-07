export type GlossaryFileErrorCode = 'empty' | 'bad_line' | 'duplicate';

export class GlossaryFileError extends Error {
  code: GlossaryFileErrorCode;
  line?: number;

  constructor(code: GlossaryFileErrorCode, line?: number) {
    super(line ? `Glossary file ${code} at line ${line}` : `Glossary ${code}`);
    this.name = 'GlossaryFileError';
    this.code = code;
    this.line = line;
  }
}

export const parseGlossaryTsv = (
  content: string,
): { entryCount: number; tsv: string } => {
  const lines = content.replace(/^﻿/, '').split(/\r\n|\r|\n/);
  const seen = new Set<string>();
  const entries: string[] = [];

  lines.forEach((raw, index) => {
    if (!raw.trim()) {
      return;
    }
    const line = index + 1;
    const columns = raw.split('\t');
    if (columns.length !== 2) {
      throw new GlossaryFileError('bad_line', line);
    }
    const source = columns[0].trim();
    const target = columns[1].trim();
    if (!source || !target) {
      throw new GlossaryFileError('bad_line', line);
    }
    if (seen.has(source)) {
      throw new GlossaryFileError('duplicate', line);
    }
    seen.add(source);
    entries.push(`${source}\t${target}`);
  });

  if (entries.length === 0) {
    throw new GlossaryFileError('empty');
  }
  return { entryCount: entries.length, tsv: entries.join('\n') };
};
