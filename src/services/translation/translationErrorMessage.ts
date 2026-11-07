import { getString } from '@i18n/translations';
import type { TranslationErrorCode } from './deeplClient';

export const translationErrorMessage = (code: TranslationErrorCode): string => {
  switch (code) {
    case 'invalid_key':
      return getString('translation.errors.invalidKey');
    case 'quota_exceeded':
      return getString('translation.errors.quotaExceeded');
    case 'rate_limited':
      return getString('translation.errors.rateLimited');
    case 'glossary_missing':
      return getString('translation.errors.glossaryMissing');
    case 'network':
      return getString('translation.errors.network');
    case 'empty_result':
      return getString('translation.errors.emptyResult');
    default:
      return getString('translation.errors.unknown');
  }
};
