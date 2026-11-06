/** The page data `handbook.mjs page` writes into the template (openspec change product-handbook-map, design D13). */

export const PAGE_FORMAT = 'excavator-product-handbook-page/6';

/** The views a page can hold (openspec change handbook-entities-and-views): the product view and the technical view. */
export const VIEWS = ['product', 'technical'] as const;
export type View = (typeof VIEWS)[number];

export const REACHES = ['menu', 'link', 'automated', 'interface', 'operator'] as const;
export type Reach = (typeof REACHES)[number];

/** The state of a feature's entry: only `verified` features carry an entry; `checked` and `confirmed` mean its verification did not finish. */
export type Status = 'planned' | 'dispatched' | 'checked' | 'confirmed' | 'verified' | 'failed';

export type EntrypointKind = 'route' | 'page' | 'job' | 'main';

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
}

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

/** One place where a table name appears outside the migrations; `rule` is `a` (a string that is the whole name) or `b` (the name after FROM, JOIN, INTO, UPDATE or TABLE). */
export interface NameMention { file: string; line: number; rule: 'a' | 'b' }

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
  droppedButDeclared: string[];
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
    droppedButDeclared: number;
    onlyInMigrations: number;
    tablesInSeveralApplications: number;
    gaps: number;
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
  /** The data section; null when `<out>/data.json` is missing or malformed, and `dataState` says which. */
  data: DataSection | null;
  dataState: 'ok' | 'missing' | 'malformed';
}

export interface PageData {
  format: typeof PAGE_FORMAT;
  project: string;
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
  coverage: Coverage;
  summary: Summary;
  system: System;
  entities: Entities;
  technical?: Technical;
}
