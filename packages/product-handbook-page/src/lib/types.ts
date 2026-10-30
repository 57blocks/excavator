/** The page data `handbook.mjs page` writes into the template (openspec change product-handbook-map, design D13). */

export const PAGE_FORMAT = 'excavator-product-handbook-page/1';

export const REACHES = ['menu', 'link', 'automated', 'interface', 'operator'] as const;
export type Reach = (typeof REACHES)[number];

/** The state of a feature's entry: only `checked` features carry an entry. */
export type Status = 'planned' | 'dispatched' | 'checked' | 'failed';

export type EntrypointKind = 'route' | 'page' | 'job' | 'main';

export interface Rule { side: 'frontend' | 'backend'; text: string }
export interface Field { label: string; rules: Rule[] }
export interface Screen { name: string; fields: Field[] }

/** A checked entry as the page shows it: the text, never the evidence. */
export interface Entry {
  purpose: string;
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

export interface Coverage {
  candidateTotal: number;
  assigned: number;
  unassigned: { candidate: string; kind: EntrypointKind; reason: string }[];
  reachCounts: { reach: Reach; count: number }[];
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
}
