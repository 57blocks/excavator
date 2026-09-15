/**
 * Pure request-local language state for /excavator-chat.
 *
 * The original question and retrieval expressions stay separate. Answer
 * language is deliberately absent until the caller confirms that its claims
 * were checked against the current fact graph or source. This module performs
 * no I/O, so request presentation can never become project configuration.
 */

const LANGUAGE_ALIASES = new Map([
  ['arabic', 'ar'],
  ['chinese', 'zh'],
  ['中文', 'zh'],
  ['english', 'en'],
  ['英文', 'en'],
  ['french', 'fr'],
  ['german', 'de'],
  ['japanese', 'ja'],
  ['日文', 'ja'],
  ['日语', 'ja'],
  ['日本語', 'ja'],
  ['korean', 'ko'],
  ['韩文', 'ko'],
  ['韩语', 'ko'],
  ['portuguese', 'pt'],
  ['russian', 'ru'],
  ['spanish', 'es'],
]);

function normalizeLanguageSignal(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new TypeError(`${fieldName} must be a language string or null`);
  const trimmed = value.trim();
  const alias = LANGUAGE_ALIASES.get(trimmed.toLocaleLowerCase('en-US'));
  if (alias) return alias;
  if (/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/iu.test(trimmed)) {
    const [base, ...variants] = trimmed.split('-');
    return [base.toLowerCase(), ...variants.map((part) => part.length === 2
      ? part.toUpperCase()
      : part.toLowerCase())].join('-');
  }
  throw new TypeError(`${fieldName} must be an ISO/BCP-47 code or a supported language name`);
}

function normalizeStringList(value, fieldName, { requireEnglish = false } = {}) {
  if (!Array.isArray(value)) throw new TypeError(`${fieldName} must be an array`);
  const normalized = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      throw new TypeError(`${fieldName} must contain non-empty strings`);
    }
    const trimmed = entry.trim();
    if (requireEnglish) {
      for (const char of trimmed) {
        if (/\p{L}/u.test(char) && !/\p{Script=Latin}/u.test(char)) {
          throw new TypeError(`English retrieval expression contains non-Latin prose: ${trimmed}`);
        }
      }
    }
    if (!normalized.includes(trimmed)) normalized.push(trimmed);
  }
  return normalized;
}

export function createChatRequestState({
  originalQuestion,
  englishRetrievalExpressions,
  literalIdentifiers = [],
  explicitAnswerLanguage = null,
  currentQuestionLanguage = null,
  recentConversationLanguage = null,
} = {}) {
  if (typeof originalQuestion !== 'string' || originalQuestion.trim().length === 0) {
    throw new TypeError('originalQuestion must be a non-empty string');
  }

  const expressions = normalizeStringList(
    englishRetrievalExpressions,
    'englishRetrievalExpressions',
    { requireEnglish: true },
  );
  if (expressions.length === 0) {
    throw new TypeError('englishRetrievalExpressions must contain at least one English/code expression');
  }

  return {
    originalQuestion,
    englishRetrievalExpressions: expressions,
    literalIdentifiers: normalizeStringList(literalIdentifiers, 'literalIdentifiers'),
    languageSignals: {
      explicit: normalizeLanguageSignal(explicitAnswerLanguage, 'explicitAnswerLanguage'),
      currentQuestion: normalizeLanguageSignal(currentQuestionLanguage, 'currentQuestionLanguage'),
      recentConversation: normalizeLanguageSignal(
        recentConversationLanguage,
        'recentConversationLanguage',
      ),
    },
  };
}

export function finalizeVerifiedAnswerLanguage(state, { evidenceVerified = false } = {}) {
  if (evidenceVerified !== true) {
    throw new Error('Answer language cannot be selected before evidence verification');
  }
  if (!state || typeof state !== 'object' || !state.languageSignals) {
    throw new TypeError('A chat request state is required');
  }

  const answerLanguage = state.languageSignals.explicit
    ?? state.languageSignals.currentQuestion
    ?? state.languageSignals.recentConversation
    ?? 'en';
  return { ...state, answerLanguage };
}

export default {
  createChatRequestState,
  finalizeVerifiedAnswerLanguage,
};
