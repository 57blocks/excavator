/** The page data `handbook.mjs page` writes into the template: format /19 (openspec change handbook-skill-first, design D7); skills/excavator-product-handbook/lib/page-data.mjs builds it. */

export const PAGE_FORMAT = 'excavator-product-handbook-page/19';

/** The views a page can hold: the product view and the technical view. */
export const VIEWS = ['product', 'technical'] as const;
export type View = (typeof VIEWS)[number];

/** Why a project, or one of its applications, has no version history (the keys of `md.history.reason.*` are these in camel case). */
export type HistoryReason = 'not-a-repository' | 'inside-repository' | 'no-commits';

/** The commits of one year: the distinct commits of all applications, and the commits of each application that has some. */
export interface HistoryYear { year: number; commits: number; byApp: Record<string, number> }

/** One application's history facts, or null in every fact with the reason when it has none. */
export interface HistoryApp { dir: string; first: string | null; last: string | null; commits: number | null; authors: number | null; authors80: number | null; reason: HistoryReason | null }

/** A file that changes much: its name (the technical part holds the path), the application it is in (null when none), its counts, the day of its last change and the verified features that cite it. */
export interface HistoryHotspot { name: string; app: string | null; commits: number; authors: number; lines: number; last: string; uncertain: number; features: string[] }

/** Two files, by name and application, changed together in `commits` commits. */
export interface HistoryPair { a: string; appA: string | null; b: string; appB: string | null; commits: number }

/** The source files and the test files of one application. */
export interface HistoryTests { dir: string; sourceFiles: number; testFiles: number }

/** The code health (openspec change handbook-history-appendix): `state` is `ok`, or says why there is nothing to show; `noHistory` is set when the project has no version history, with the reason; `conventions` are the keys of the naming conventions a test file follows (the fixed text of each is `md.history.test.<key>`). */
export interface History {
  state: 'ok' | 'missing' | 'malformed';
  noHistory: { reason: 'not-a-repository' | 'inside-repository' } | null;
  years: HistoryYear[];
  apps: HistoryApp[];
  hotspots: HistoryHotspot[];
  coChange: HistoryPair[];
  tests: HistoryTests[];
  conventions: string[];
}

/** One place where a table name appears outside the migrations; `rule` is `a` (a string that is the whole name), `b` (the name after FROM, JOIN, INTO, UPDATE or TABLE, or at the start of the string of a Table( call) or `c` (the name right after many2many:). */
export interface NameMention { file: string; line: number; rule: 'a' | 'b' | 'c' }

/** One table of the data section: where it is declared, the migrations that created and last changed it, and where its name appears by application (the empty key is the places that belong to no application). */
export interface DataTable {
  name: string;
  /** `as` is the name the line shows when it is an earlier name of the table (the table was renamed later). */
  sources: { kind: 'migration' | 'model' | 'sql'; file: string; line: number; as?: string }[];
  createdBy: string | null;
  lastChangedBy: string | null;
  mentions: Record<string, NameMention[]>;
}

/** The data section as the page draws it (data.json without its ledgers): the lists, the gaps and the counts the script computed. */
export interface DataSection {
  /** The keys of the declaration forms this version recognizes; the page words each by a fixed text. */
  recognized: string[];
  applications: { directory: string; migrations: number }[];
  tables: DataTable[];
  dropped: { name: string; file: string; line: number; createdBy: string | null; directory: string }[];
  changedNeverCreated: string[];
  declaredOnly: string[];
  removedButDeclared: string[];
  onlyInMigrations: string[];
  gaps: {
    unsplitMigrations: { file: string }[];
    unnamedOperations: { file: string; line: number; op: string; via: 'call' | 'sql' }[];
    unresolvedModelNames: { file: string; line: number; expression: string; matches: number | null }[];
    otherMigrationFiles: { file: string; reason: string }[];
  };
  counts: {
    tables: number;
    migrations: number;
    migrationsReplayed: number;
    migrationsUnsplit: number;
    migrationsDownOnly: number;
    otherMigrationFiles: number;
    operations: { total: number; create: number; drop: number; rename: number; change: number; unnamed: number };
    declarations: { total: number; model: number; sql: number; unresolved: number };
    dropped: number;
    changedNeverCreated: number;
    declaredOnly: number;
    removedButDeclared: number;
    onlyInMigrations: number;
    tablesInSeveralApplications: number;
    gaps: number;
  };
}

/** One comment next to a member, as written; `where` is above the member or on its line. */
export interface DictionaryComment { text: string; file: string; line: number; endLine?: number; where: 'above' | 'same-line' }

/** One member of a value set: the value (a string, a number, or the expression as written when it is not computed; null when there is none), the comments and display names the code gives it, and its place. */
export interface DictionaryMember {
  name: string;
  value: string | number | null;
  computed: boolean;
  reason?: 'expression' | 'after-uncomputed';
  /** `var` for a member of a Go value set that was declared with var; absent for const. */
  declaredAs?: 'var';
  file: string;
  line: number;
  comments: DictionaryComment[];
  labels: { text: string; file: string; line: number }[];
}

export type DictionaryForm = 'go-type' | 'ts-enum' | 'ts-const-object' | 'js-object';

/** One value set; `application` is the empty string for a file that belongs to no application. */
export interface DictionaryEntry {
  id: string;
  application: string;
  form: DictionaryForm;
  name: string;
  file: string;
  line: number;
  /** The underlying type of a Go named type. */
  baseType?: string;
  members: DictionaryMember[];
  skippedMembers: number;
}

/** A value with the member names that have it. */
export interface DictionaryValue { value: string | number; members: string[] }

/** Two value sets of the same name in two applications whose values differ. */
export interface DictionaryMismatch {
  key: string;
  left: { id: string; application: string; name: string };
  right: { id: string; application: string; name: string };
  onlyLeft: DictionaryValue[];
  onlyRight: DictionaryValue[];
  both: { value: string | number; left: string[]; right: string[] }[];
  uncompared: { left: string[]; right: string[] };
}

/** The status dictionary as the page draws it (dictionaries.json without its candidate ledger and scan counts). */
export interface DictionariesSection {
  /** The keys of the forms this version recognizes; the page words each by a fixed text. */
  recognized: string[];
  applications: { directory: string; dictionaries: number }[];
  dictionaries: DictionaryEntry[];
  mismatches: DictionaryMismatch[];
  counts: {
    dictionaries: { total: number; goType: number; tsEnum: number; tsConstObject: number; jsObject: number };
    members: { total: number; computed: number; notComputed: number };
    comments: number;
    labels: number;
    skippedMembers: number;
    candidates: {
      goTypes: { total: number; dictionary: number; noConstants: number; duplicate: number };
      goConstants: { total: number; member: number; untypedIota: number; otherType: number; plain: number };
      goVars: { total: number; member: number; otherType: number };
      tsEnums: { total: number; dictionary: number };
      tsConstObjects: { total: number; dictionary: number; noLiteralMembers: number };
      jsObjects: { total: number; dictionary: number; noLiteralMembers: number };
      mapEntries: { total: number; label: number; unmatchedKey: number; ambiguousKey: number };
    };
    mismatches: number;
  };
}


/**
 * The index of the part files of a page whose data is large (openspec change handbook-page-chunked-data): the ids of the
 * parts in order and, for each unit, the parts that hold it in order. Both are empty when the page is one file. A unit is the
 * detail shown on one page: `chapter:<id>` (the Markdown of one chapter in each view), `coverage`, `data`, `dictionaries` and `history`.
 */
export interface Chunks {
  parts: string[];
  units: Record<string, string[]>;
}

/** What a block of the outline is: a chapter written as Markdown, or one of the blocks the scripts write. */
export type BlockKind = 'chapter' | 'data' | 'dictionaries' | 'history';

/** One block of a part of the outline: its id (a chapter's file name, or `data`, `dictionaries`, `history`), its kind and its title (a chapter's first level-1 heading). */
export interface OutlineBlock { block: string; kind: BlockKind; title: string }

/** A block the outline leaves out: its id and the reason. */
export interface OutlineUnplaced { block: string; reason: string }

/** The outline both outputs follow: `source` is `outline` for a written one that passed its check, `default` otherwise, with the lines of why in `problems`. */
export interface Outline {
  source: 'outline' | 'default';
  problems: string[];
  parts: { title: string; blocks: OutlineBlock[] }[];
  unplaced: OutlineUnplaced[];
}

/** The text of a chapter, or of the coverage section, in each selected view; empty in the core of a page whose texts are in part files. */
export type ViewTexts = Partial<Record<View, string>>;

/** One chapter the outline places: its Markdown by view (its own level-1 heading is the page's heading). */
export interface ChapterData { id: string; texts: ViewTexts }

/** The part of the data only the technical view has: the data section, the status dictionaries and the paths of the code health. */
export interface Technical {
  /** The data section; null when `<out>/data.json` is missing or malformed (or the outline leaves it out), and `dataState` says which. */
  data: DataSection | null;
  dataState: 'ok' | 'missing' | 'malformed';
  /** The status dictionary; null when `<out>/dictionaries.json` is missing or malformed (or the outline leaves it out), and `dictionariesState` says which. */
  dictionaries: DictionariesSection | null;
  dictionariesState: 'ok' | 'missing' | 'malformed';
  /** The path of each hotspot file and of each file of a pair of `PageData.history`, in the order of its rows; null when there is no code health. */
  history: { hotspots: string[]; coChange: { a: string; b: string }[] } | null;
}

export interface PageData {
  format: typeof PAGE_FORMAT;
  chunks: Chunks;
  language: string;
  languageTag: string;
  ui: { strings: Record<string, string> };
  /** The selected views in the fixed order; the page has a switch only when there are two. */
  views: View[];
  /** The title of each selected view. */
  titles: Partial<Record<View, string>>;
  outline: Outline;
  /** The chapters the outline places, in its order. */
  chapters: ChapterData[];
  /** The coverage section as Markdown, by view. */
  coverage: ViewTexts;
  /** The code health (both views); null when the run has none or the outline leaves it out. */
  history: History | null;
  technical?: Technical;
}
