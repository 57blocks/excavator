/** The page data `handbook.mjs page` writes into the template (openspec change product-handbook-map, design D13). */

export const PAGE_FORMAT = 'excavator-product-handbook-page/3';

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

export interface Feature {
  id: string;
  name: string;
  area: string;
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

/** One area of the map with the counts and roles the script computes from the verified entries. */
export interface AreaRow { id: string; name: string; features: number; verified: number; roles: string[] }

/** The system overview and the facts of the script: `overview` is null unless the overview is verified (`status` says where it stopped); the application rows, counts and areas do not depend on it. */
export interface System {
  status: Status;
  overview: OverviewText | null;
  applications: ApplicationFacts[];
  counts: { applications: number; files: number; lines: number; areas: number; features: number; featuresWithEntry: number; roles: number };
  areas: AreaRow[];
}

export interface PageData {
  format: typeof PAGE_FORMAT;
  project: string;
  language: string;
  languageTag: string;
  ui: { strings: Record<string, string> };
  areas: Area[];
  features: Feature[];
  coverage: Coverage;
  summary: Summary;
  system: System;
}
