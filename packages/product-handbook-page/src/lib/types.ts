/** The page data `handbook.mjs page` writes into the template: format /23 (openspec changes handbook-skill-first, design D7, handbook-page-domain-map, design D3, handbook-page-structure, design D1, and handbook-process-review, design D10); skills/excavator-product-handbook/lib/page-data.mjs builds it. */

export const PAGE_FORMAT = 'excavator-product-handbook-page/23';

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
 * detail shown on one page: `chapter:<id>` (the Markdown of one chapter in each view), `coverage`, `data`, `dictionaries`, `history` and `problems`.
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

/** Whether `domains.json` can be used: `ok`, `missing` (no file, no record or no digest), `failed` (the domains chapter did not pass) or `changed` (the file differs from the checked one). */
export type DomainsState = 'ok' | 'missing' | 'failed' | 'changed';

/** One business domain: its id (`d1`, `d2`, ...), its name, its feature ids, the first paragraph of its section of the domains chapter and the rest of that section, by view. */
export interface DomainData { id: string; name: string; features: string[]; intro: ViewTexts; body: ViewTexts }

/** A hand-over between two domains (by id); `features` are the feature ids its `what` names; `cites` only with the technical view. */
export interface HandoverData { from: string; to: string; what: string; features: string[]; cites?: string[] }

/** One entry of the search index: a domain, a chapter, a `##` or `###` heading of a chapter (`heading` counts them from 0 in the chapter), or a defect or design problem by its number (`D3 title`). */
export interface SearchItem {
  kind: 'domain' | 'chapter' | 'heading' | 'problem' | 'process';
  title: string;
  chapter: string | null;
  domain: string | null;
  heading: number | null;
  /** 2 or 3 for a heading, null for the other kinds. */
  level: 2 | 3 | null;
  /** The id of the problem row (`d3`, `r12`) of a `problem` item, the process (`P4`) of a `process` item. */
  id?: string;
}

/** An item of the remedies chapter placed under a domain or a process: its line in the chapter and the rows (`d3`, `r12`) its problem lines are for. */
export interface RemedyRef { line: number; problems: string[] }

/**
 * The items of a remedies chapter that names ids, under the business domains they involve (page-remedies.mjs): `items` holds the text of
 * each by view, `domains` (in the page's order, only those with items) the items under each process of the domain and under each fixed
 * section of the chapter, `untied` the items that involve no domain. Null for a chapter that names no id or a page without usable domains.
 */
export interface RemedyDomains {
  items: ProcessRemedy[];
  domains: { id: string; processes: { id: string; items: RemedyRef[] }[]; sections: { heading: string; items: RemedyRef[] }[] }[];
  untied: RemedyRef[];
}

/** The three kinds of problem rows: defects (parser), design problems (checked batches), open questions (fixed section of a chapter). */
export type ProblemType = 'defect' | 'design' | 'open';
export type ProblemLevel = 'P0' | 'P1' | 'P2' | 'high' | 'medium' | 'low';

/** Whether a source of problem rows can be used: `ok`, `missing` (not written), `failed` (did not pass its check) or `changed` (differs from the checked one). */
export type ProblemSourceState = 'ok' | 'missing' | 'failed' | 'changed';
export interface ProblemSource { state: ProblemSourceState; count: number | null }

/** A design row's text: the situation and its consequence. */
export interface DesignText { situation: string; consequence: string }

/**
 * One row of the problems table. `features` are feature ids or `system`. `texts` is the full text by view (a design row's is a
 * situation and a consequence); it is empty in the core of a page whose problems are in a part file, like `cites` (the technical view's only).
 * `process` (`P<n>`) is on a design row whose item names a process. `remedies` are the items of the remedies chapter that name the row, in chapter
 * order: `heading` is the title of the item's level-2 section and `anchor` the id the remedies page puts on the item (an older chapter that names
 * no id gives the one heading that names the category or dimension, its anchor the page heading id `h-<n>`); `[]` for none and for an open question.
 */
export interface ProblemRow {
  id: string;
  type: ProblemType;
  level: ProblemLevel | null;
  group: string | null;
  features: string[];
  summary: string;
  texts: Partial<Record<View, string | DesignText>>;
  cites?: string[];
  process?: string;
  source: { chapter: string; line: number };
  remedies: RemedyLink[];
}

/** One item of the remedies chapter that names a problem row: the title of its section and the id of its element, on the remedies page or, with `process` (`P<n>`), on the page of that process. */
export interface RemedyLink { heading: string; anchor: string; process?: string; domain?: string }

/** One step of a process: who does it, the operation (the title of an operation of the feature), the feature id, the sentence and, in the technical view, its citations. */
export interface ProcessStep { role: string; operation: string; feature: string; text: string; cites?: string[] }

/** An item of the remedies chapter written under a process: the line it starts on in the chapter (its anchor is `remedy-<line>`) and its Markdown by view. */
export interface ProcessRemedy { line: number; texts: Partial<Record<View, string>> }

/**
 * A business process: its number `P<n>`, its name, the id of the domain of its first step's feature (when the page knows one), its steps,
 * its end state when it has one, the feature ids of its steps in step order, each once, and the items of the remedies chapter under its heading.
 */
export interface ProcessItem { id: string; name: string; domain?: string; steps: ProcessStep[]; end?: { text: string; cites?: string[] }; features: string[]; remedies?: ProcessRemedy[] }

/** The business processes of the page (null without a usable chapter): the processes and, by feature, the operations that no step names. */
export interface ProcessesData { items: ProcessItem[]; coverage: { feature: string; operations: string[] }[] }

/** The problems of the page: the state and count of each source, the rows (defects, then design problems, then open questions) and the remedies chapter id (null without one). */
export interface ProblemsData {
  sources: { defects: ProblemSource; design: ProblemSource; open: ProblemSource & { unmatched: string[] } };
  rows: ProblemRow[];
  remedies: 'remedies' | null;
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
  /** The business domains and the hand-overs between them; `list` and `handovers` are empty unless `state` is `ok`. */
  domains: { state: DomainsState; list: DomainData[]; handovers: HandoverData[] };
  /** The table of problems; its rows' full texts are in the `problems` unit of a chunked page. */
  problems: ProblemsData;
  /** The business processes; null when the run has no usable business-processes chapter, so the page has no processes page. */
  processes: ProcessesData | null;
  /** The items of the improvement suggestions under the business domains; null when the page shows the chapter as it is. */
  remedyDomains: RemedyDomains | null;
  /** The first paragraph of the system chapter (product view text); empty without a system chapter. */
  lead: string;
  /** The section of the system chapter that holds its first diagram, by view; '' without one. */
  architecture: ViewTexts;
  /** The search index: domains, then each chapter followed by its headings. */
  search: SearchItem[];
  technical?: Technical;
}
