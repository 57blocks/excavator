/** The page data `lib/page-data.mjs` writes (openspec change prd-report-page, design D3). */

export const PAGE_FORMAT = 'excavator-prd-report-page/1';

export const STATUSES = ['verified', 'checked', 'written', 'planned', 'failed'] as const;
export type Status = (typeof STATUSES)[number];

export const VERIFICATION_KEYS = [
  'verified', 'contradicted', 'misattributed', 'unverifiable',
  'resolvedRight', 'resolvedWrong', 'stillOpen', 'conflicts', 'notChecked',
] as const;
export type VerificationKey = (typeof VERIFICATION_KEYS)[number];
export type VerificationCounts = Record<VerificationKey, number>;

export type FindingClass = 'product' | 'technical';

export const PRIORITIES = ['P0', 'P1', 'P2'] as const;
/** A finding's level as aggregate writes it; null is a finding no ranking subagent has given a level. */
export type Priority = (typeof PRIORITIES)[number];
export interface PriorityCounts { P0: number; P1: number; P2: number; unranked: number }

export interface Evidence {
  file: string;
  passage: string;
  line?: number;
}

export interface Finding {
  id: string;
  class: FindingClass;
  statement: string;
  flows: string[];
  evidence: Evidence[];
  feature: string;
  verdict: string;
  priority: Priority | null;
  priorityReason: string | null;
}

export interface Candidate {
  id: string;
  kind: string;
  file: string;
  line: number;
  text: string;
  framework: string;
}

export interface Failure {
  step: string;
  reasons: string[];
}

export interface Feature {
  id: string;
  name: string;
  kind: string;
  chapter: number;
  status: Status;
  failure: Failure | null;
  attempts: number;
  counts: {
    diagrams: number;
    evidence: number;
    findings: { product: number; technical: number; priority: PriorityCounts };
    verification: VerificationCounts | null;
  };
  entrypoints: Candidate[];
  roles: string[];
  triggers: string[];
  body: string | null;
  verificationReport: string | null;
}

export interface PageData {
  format: string;
  project: string;
  sourceRevision: string;
  language: string;
  role: string;
  scope: string | null;
  counts: {
    features: { total: number; written: number; failed: number };
    diagrams: number;
    findings: { product: number; technical: number; priority: PriorityCounts };
    verification: VerificationCounts;
  };
  overview: string;
  features: Feature[];
  findings: Finding[];
  tables: { rolesByFeature: string; coverage: string; verification: string };
  unassigned: Candidate[];
  uncovered: string[];
}
