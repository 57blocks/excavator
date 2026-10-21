/**
 * Pure request-local language state for /excavator-chat.
 *
 * The original question and retrieval expressions stay separate. Answer
 * language is deliberately absent until the caller confirms that its claims
 * were checked against the current fact graph, source or product. The
 * functions perform no I/O, and the CLI only prints its selection, so request
 * presentation can never become project configuration.
 *
 * CLI, run by every chat route right before the answer is written:
 *   node request-language.mjs --evidence-verified \
 *     --explicit <language|none> --question <language|none> --recent <language|none>
 * It takes language signals only, never the question text, so nothing the
 * user wrote passes through a shell.
 */

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const LANGUAGE_ALIASES = new Map([
  ['arabic', 'ar'],
  ['chinese', 'zh'],
  ['\u4e2d\u6587', 'zh'], // "Chinese" in Chinese
  ['english', 'en'],
  ['\u82f1\u6587', 'en'], // "English" in Chinese
  ['french', 'fr'],
  ['german', 'de'],
  ['japanese', 'ja'],
  ['\u65e5\u6587', 'ja'], // "Japanese" in Chinese
  ['\u65e5\u8bed', 'ja'], // "Japanese language" in Chinese
  ['\u65e5\u672c\u8a9e', 'ja'], // "Japanese" in Japanese
  ['korean', 'ko'],
  ['\u97e9\u6587', 'ko'], // "Korean" in Chinese
  ['\u97e9\u8bed', 'ko'], // "Korean language" in Chinese
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

const CLI_SIGNALS = new Map([
  ['--explicit', 'explicit'],
  ['--question', 'currentQuestion'],
  ['--recent', 'recentConversation'],
]);

/**
 * Parse the CLI arguments and select the answer language. All three signals
 * are required (`none` when absent) so every run records a judgment on each.
 */
export function answerLanguageFromArgs(args) {
  let evidenceVerified = false;
  const signals = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--evidence-verified') {
      if (evidenceVerified) throw new TypeError('--evidence-verified given twice');
      evidenceVerified = true;
      continue;
    }
    const key = CLI_SIGNALS.get(arg);
    if (!key) throw new TypeError(`Unexpected argument: ${arg}`);
    if (key in signals) throw new TypeError(`${arg} given twice`);
    if (i + 1 >= args.length) throw new TypeError(`${arg} needs a language, or none`);
    const value = args[i += 1];
    if (value.trim() === '') throw new TypeError(`${arg} needs a language, or none`);
    signals[key] = value.trim().toLowerCase() === 'none' ? null : normalizeLanguageSignal(value, arg);
  }
  for (const [flag, key] of CLI_SIGNALS) {
    if (!(key in signals)) throw new TypeError(`${flag} is required (a language, or none)`);
  }
  const { answerLanguage } = finalizeVerifiedAnswerLanguage({ languageSignals: signals }, { evidenceVerified });
  return { answerLanguage, signals };
}

function isCliEntry() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isCliEntry()) {
  try {
    process.stdout.write(`${JSON.stringify(answerLanguageFromArgs(process.argv.slice(2)))}\n`);
  } catch (err) {
    process.stderr.write(`request-language.mjs failed: ${err.message}\n`);
    process.exit(1);
  }
}

export default {
  createChatRequestState,
  finalizeVerifiedAnswerLanguage,
  answerLanguageFromArgs,
};
