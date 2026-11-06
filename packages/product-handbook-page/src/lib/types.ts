/** The page data `handbook.mjs page` writes into the template (openspec change product-handbook-map, design D13). */

export const PAGE_FORMAT = 'excavator-product-handbook-page/12';

/** The views a page can hold (openspec change handbook-entities-and-views): the product view and the technical view. */
export const VIEWS = ['product', 'technical'] as const;
export type View = (typeof VIEWS)[number];

export const REACHES = ['menu', 'link', 'automated', 'interface', 'operator'] as const;
export type Reach = (typeof REACHES)[number];

/** The state of a feature's entry: only `verified` features carry an entry; `checked` and `confirmed` mean its verification did not finish. */
export type Status = 'planned' | 'dispatched' | 'checked' | 'confirmed' | 'verified' | 'failed';

export type EntrypointKind = 'route' | 'page' | 'job' | 'main';

/** The root causes a finding is sorted by, in the order the handbook lists them (the fixed text of each is `findingCategoryKey(value)`). */
export const FINDING_CATEGORIES = ['authorization', 'error-handling', 'notification', 'consistency', 'calculation', 'hard-coded', 'contract', 'security', 'display', 'time', 'other'] as const;
export type FindingCategory = (typeof FINDING_CATEGORIES)[number];
/** The key of a category's display name in the ui table: `error-handling` is `errorHandling`, since keys hold letters and dots only. */
export const findingCategoryKey = (category: FindingCategory): string => `md.findings.category.${category.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())}`;

/** The levels of the ranking of the findings (openspec change handbook-findings-priority), most urgent first. */
export const LEVELS = ['P0', 'P1', 'P2'] as const;
export type Level = (typeof LEVELS)[number];
/** The consequences a lane picks, each deciding a level (the fixed text of each is `consequenceKey(value)`). */
export const CONSEQUENCES = ['othersRecords', 'money', 'dataLoss', 'secret', 'wrongResult', 'notification', 'blocked', 'display', 'inert'] as const;
export type Consequence = (typeof CONSEQUENCES)[number];
export const consequenceKey = (consequence: Consequence): string => `md.priority.consequence.${consequence}`;
/** The rank of a group of findings: the level its consequence decides and the reason, which only repeats what the statements say. */
export interface Priority { level: Level; consequence: Consequence; reason: string }

/** A group a recommendation rests on: the first finding's id (the technical part holds its places), the category, the level (null for a group without one) and the representative statement. */
export interface RemedyGroup { id: string; category: FindingCategory; level: Level | null; text: string }

/** A cited fact that is not a group, with the values the script computed; the page writes it in words from the run's fixed text. */
export type RemedyFact =
  | { kind: 'app'; name: string; language: string | null; files: number; lines: number; commits: number | null; authors: number | null }
  | { kind: 'tables'; count: number | null; tables: { name: string; applications: string[] }[] }
  | { kind: 'counts'; groups: number; levels: { P0: number; P1: number; P2: number; unranked: number }; categories: { category: FindingCategory; count: number }[] };

/** The remedies the judges confirmed (openspec change handbook-remedies): the common cause and measure of each category, and the recommendations in the order they are to be done. */
export interface Remedies {
  categories: { category: FindingCategory; cause: string; measure: string }[];
  recommendations: { title: string; text: string; groups: RemedyGroup[]; facts: RemedyFact[] }[];
}

export interface Rule { side: 'frontend' | 'backend'; text: string }
export interface Field { label: string; rules: Rule[] }
export interface Screen { name: string; fields: Field[] }

/** A verified entry as the page shows it: the text, never the evidence. */
export interface Entry {
  /** Absent when the purpose was removed as not verified. */
  purpose?: string;
  who: { role: string; can: string }[];
  where: string[];
  screens: Screen[];
  operations: { name: string; sentences: string[] }[];
  states: { label: string; meaning: string }[];
  notifications: { trigger: string; recipient: string; channel: string; content: string }[];
  automatic: { when: string; effect: string }[];
  unknowns: { item: string; searched: string }[];
}

export interface Area { id: string; name: string }

/** What the page's domains are: the business domains of domains.json, or the map's areas drawn by the navigation when there are none. */
export type DomainBasis = 'domains' | 'areas';

export interface Feature {
  id: string;
  name: string;
  /** The map's area, a property of the feature. */
  area: string;
  /** The id of the domain the feature is grouped in (an area id when `domainBasis` is `areas`). */
  domain: string;
  reach: Reach;
  /** The label readers see in the product, for `menu` and `link` features. */
  label?: string;
  status: Status;
  entry: Entry | null;
  /** Where the verification of the feature's findings stands: only `verified` ones are in `PageData.findings`. */
  findingsStatus: Status;
}

/** Who a finding belongs to: a feature, or an application (`id` is `app<n>`, `name` the verified overview's name for its directory, else the directory). */
export interface FindingOwner { kind: 'feature' | 'application'; id: string; name: string }

/** One verified finding: `id` is the unit id and the item path (`F3.findings[0]`, `app1.system[0]`), the text the statement of the defect and when it happens. */
export interface FindingItem { id: string; owner: FindingOwner; text: string }

/** Findings of one category at the same place, which the handbook counts as one: `items` in the order of the handbook (the first is the representative), `owners` the distinct owners of the items in that order. */
export interface FindingGroup { category: FindingCategory; owners: FindingOwner[]; items: FindingItem[]; /** Null when no two judges confirmed a rank for the group, or the ranking did not finish. */ priority: Priority | null }

/** An item the verification removed from a feature's entry: its claim, why it went, and the verifier's reason. */
export interface RemovedItem { claim: string; verdict: 'unverified' | 'contradicted' | 'withParent'; reason: string }

export interface Coverage {
  candidateTotal: number;
  assigned: number;
  unassigned: { candidate: string; kind: EntrypointKind; reason: string }[];
  reachCounts: { reach: Reach; count: number }[];
  /** The items the verification removed from the system overview (empty when it lost none). */
  removedOverview: RemovedItem[];
  /** The features that lost items to verification, with those items. */
  removed: { feature: string; items: RemovedItem[] }[];
  /** The features whose findings unit is not verified with where it stands; the units never written are not rows, see `findingsNotWritten`. */
  findingsUnfinished: { feature: string; status: Status }[];
  /** How many features have a findings unit that was never written (planned); they are one count, not rows. */
  findingsNotWritten: number;
  /** The features that lost findings to verification, with those findings. */
  findingsRemoved: { feature: string; items: RemovedItem[] }[];
  /** How many application roots there are, one system findings unit each. */
  systemFindingsTotal: number;
  /** The application roots whose system findings unit is not verified with where it stands; the units never written are one count, see `systemFindingsNotWritten`. */
  systemFindingsUnfinished: { id: string; name: string; status: Status }[];
  /** How many application roots have a system findings unit that was never written (planned). */
  systemFindingsNotWritten: number;
  /** The application roots that lost system findings to verification, with those findings. */
  systemFindingsRemoved: { id: string; name: string; items: RemovedItem[] }[];
  /** The ranking of the findings: `finished` false when the unit is not verified (every group is then unranked); the groups without a priority, each by its representative finding, with the reasons of the judges (empty when none judged it). */
  priority: { finished: boolean; unranked: { id: string; category: FindingCategory; text: string; reasons: string[] }[] };
  /** The remedies: `finished` false when the unit is not verified or was written for other findings (`stale`), and then none is shown; `dropped` the paragraphs and recommendations a judge refused, `text` the cause or the recommendation's text, with the judges' reasons. */
  remedies: { finished: boolean; stale: boolean; dropped: { id: string; kind: 'category' | 'recommendation'; category?: FindingCategory; title?: string; text: string; reasons: string[] }[] };
}

/** One notification of a verified entry, in the entry's words; `feature` is the id of the feature. */
export interface NotificationRow { feature: string; trigger: string; recipient: string; channel: string; content: string }

/** Where a scheduled job's time table was found: written out on the registration line, worked out when the job is registered, or not in that line's text. */
export type ScheduleBucket = 'literal' | 'computed' | 'absent';

/** One scheduled-job candidate. `feature` is null when the map left it unassigned, then `reason` is the map's. */
export interface JobRow {
  kind: 'job';
  candidate: string;
  feature: string | null;
  reason: string | null;
  schedule: { bucket: ScheduleBucket; literal: string | null };
  /** The verified automatic items whose citation covers the registration line. */
  automatic: { when: string; effect: string }[];
}

/** The two cross-cutting tables and their counts. */
export interface Summary {
  notifications: NotificationRow[];
  jobs: JobRow[];
  counts: {
    featureTotal: number;
    featuresWithEntry: number;
    notificationRows: number;
    jobRows: number;
    schedule: { literal: number; computed: number; absent: number };
    described: number;
  };
}

/** One row of the applications table: what the script found in an application root (or a listed application below one); `name` and `does` are null when no verified application stands for the directory; `history` is null when it has no version history. */
export interface ApplicationFacts {
  dir: string;
  name: string | null;
  does: string | null;
  languages: { language: string; files: number }[];
  frameworks: { framework: string; candidates: number }[];
  files: number;
  lines: number;
  history: { first: string; last: string; commits: number; authors: number } | null;
}

/** The text of a verified system overview, without its evidence. */
export interface OverviewText {
  /** The system name of the overview, or null (it has none, verification removed it, or the overview is older than the name). */
  name: string | null;
  summary: string[];
  audiences: { who: string; does: string }[];
  integrations: { system: string; use: string; callers: string[] }[];
  unknowns: { item: string; searched: string }[];
}

/** One group of features (a domain, or an area of the map) with the counts and roles the script computes from the verified entries. */
export interface AreaRow { id: string; name: string; features: number; verified: number; roles: string[] }

/** The system overview and the facts of the script: `overview` is null unless the overview is verified (`status` says where it stopped); the application rows, counts and areas do not depend on it. */
export interface System {
  status: Status;
  overview: OverviewText | null;
  applications: ApplicationFacts[];
  counts: { applications: number; files: number; lines: number; areas: number; domains?: number | null; features: number; featuresWithEntry: number; roles: number };
  areas: AreaRow[];
  /** The same rows over the domains the page groups by (the areas again when `domainBasis` is `areas`). */
  domains: AreaRow[];
}

/** A domain (a business domain, or an area of the map when there is no domains file): its features, and the purposes of those that were verified, in the words of their entries. */
export interface Domain { id: string; name: string; features: string[]; purposes: { feature: string; text: string }[] }

/** What the verified entry of a feature says a role can do; a role-feature pair the entries do not name has no cell. */
export interface RoleFeatureMatrix { roles: string[]; features: string[]; cells: { role: string; feature: string; can: string[] }[] }

/** The product part of the entities: no application, no citation path. */
export interface Entities { domains: Domain[]; roles: { label: string }[]; roleFeature: RoleFeatureMatrix }

/** Quoted passages of the domain's verified features in each application; `unattributed` counts those in no application. */
export interface ApplicationDomainMatrix {
  applications: string[];
  domains: string[];
  cells: { application: string; domain: string; citations: number }[];
  unattributed: { domain: string; citations: number }[];
}

/**
 * An external system of the verified overview with the two relations to applications, kept apart: `shown` are the callers
 * the quoted code shows (checked), `named` the applications whose source files hold the name as written (the script's
 * search; it does not say the application calls the system), `namedOutside` the files holding the name that no application holds.
 */
export interface IntegrationRelations { system: string; use: string; shown: string[]; named: { application: string; files: number }[]; namedOutside: number }

/** The file and lines of each passage quoted for each item of a verified unit (a feature id, or `overview`); null lines when the passage could not be located. */
export interface UnitLocations {
  id: string;
  items: { claim: string; citations: { file: string; startLine: number | null; endLine: number | null }[] }[];
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

/** The technical part: only in a page that has the technical view. Holds the only citation paths of the page data. */
export interface Technical {
  featureApplication: { feature: string; application: string; citations: number }[];
  unattributed: { feature: string; citations: number }[];
  applicationDomain: ApplicationDomainMatrix;
  integrations: IntegrationRelations[];
  jobs: { candidate: string; feature: string | null; application: string | null }[];
  locations: UnitLocations[];
  /** The file and lines of each passage quoted for each finding of the items of `PageData.findings`, by item id; null lines when a passage could not be located. */
  findingLocations: { id: string; citations: { file: string; startLine: number | null; endLine: number | null }[] }[];
  /** The data section; null when `<out>/data.json` is missing or malformed, and `dataState` says which. */
  data: DataSection | null;
  dataState: 'ok' | 'missing' | 'malformed';
  /** The status dictionary; null when `<out>/dictionaries.json` is missing or malformed, and `dictionariesState` says which. */
  dictionaries: DictionariesSection | null;
  dictionariesState: 'ok' | 'missing' | 'malformed';
}

export interface PageData {
  format: typeof PAGE_FORMAT;
  /** The system name the verified overview kept, or null; never the directory of the project. */
  project: string | null;
  language: string;
  languageTag: string;
  ui: { strings: Record<string, string> };
  /** The selected views in the fixed order; the page has a switch only when there are two. */
  views: View[];
  areas: Area[];
  /** The groups the page navigates by. */
  domains: Area[];
  domainBasis: DomainBasis;
  features: Feature[];
  /** The verified findings of the features and the application roots as groups, in the order of the first finding of each: the features in the map's order, then the application roots, each in its file's order. */
  findings: FindingGroup[];
  remedies: Remedies;
  coverage: Coverage;
  summary: Summary;
  system: System;
  entities: Entities;
  technical?: Technical;
}
