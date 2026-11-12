/**
 * The BCP 47 language tag of the run's free-form `--language` value, for the
 * page's `<html lang>`. A small table covers the common names (English names
 * and a few native ones); a value that already looks like a tag is kept; any
 * other value is `und` (undetermined). It never fails: the language of a run
 * is not limited to a built-in list (design D12). The native names are built
 * from code points so that this file holds only ASCII.
 */

const cp = (...points) => String.fromCodePoint(...points);

const NAMES = {
  english: 'en',
  chinese: 'zh',
  mandarin: 'zh',
  'simplified chinese': 'zh-Hans',
  'chinese simplified': 'zh-Hans',
  'chinese (simplified)': 'zh-Hans',
  'traditional chinese': 'zh-Hant',
  'chinese traditional': 'zh-Hant',
  'chinese (traditional)': 'zh-Hant',
  cantonese: 'yue',
  japanese: 'ja',
  korean: 'ko',
  spanish: 'es',
  french: 'fr',
  german: 'de',
  italian: 'it',
  portuguese: 'pt',
  'brazilian portuguese': 'pt-BR',
  dutch: 'nl',
  russian: 'ru',
  ukrainian: 'uk',
  polish: 'pl',
  czech: 'cs',
  swedish: 'sv',
  danish: 'da',
  norwegian: 'nb',
  finnish: 'fi',
  greek: 'el',
  turkish: 'tr',
  arabic: 'ar',
  hebrew: 'he',
  persian: 'fa',
  hindi: 'hi',
  bengali: 'bn',
  thai: 'th',
  vietnamese: 'vi',
  indonesian: 'id',
  malay: 'ms',
  // Native names.
  espanol: 'es',
  francais: 'fr',
  deutsch: 'de',
  italiano: 'it',
  portugues: 'pt',
  nederlands: 'nl',
  polski: 'pl',
  [cp(0x4e2d, 0x6587)]: 'zh',
  [cp(0x7b80, 0x4f53, 0x4e2d, 0x6587)]: 'zh-Hans',
  [cp(0x7e41, 0x9ad4, 0x4e2d, 0x6587)]: 'zh-Hant',
  [cp(0x65e5, 0x672c, 0x8a9e)]: 'ja',
  [cp(0xd55c, 0xad6d, 0xc5b4)]: 'ko',
};

/** Looks like a tag: a 2 or 3 letter language, then subtags of 1 to 8 letters or digits. */
const TAG_SHAPE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/;

/** The key a name is looked up under: lower case, accents and extra white space removed. */
const key = (language) => language.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** The tag for `language`; `und` when it is neither a known name nor already a tag. */
export function languageTag(language) {
  if (typeof language !== 'string') return 'und';
  const name = key(language);
  if (Object.hasOwn(NAMES, name)) return NAMES[name];
  const trimmed = language.trim();
  return TAG_SHAPE.test(trimmed) ? trimmed : 'und';
}
