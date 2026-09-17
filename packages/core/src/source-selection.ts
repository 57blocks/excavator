import ignore, { type Ignore } from "ignore";
import { extname } from "node:path";

import { DEFAULT_IGNORE_PATTERNS } from "./ignore-filter.js";

export const SOURCE_SELECTION_POLICY_VERSION = "source-selection-v1";
export const PRIVATE_KEY_PREFIX_BYTES = 4096;

export const SENSITIVE_EXTENSIONS = Object.freeze([
  ".pem", ".key", ".ks", ".jks", ".pfx", ".p12", ".set",
] as const);

export const PRIVATE_KEY_HEADERS = Object.freeze([
  "-----BEGIN PRIVATE KEY-----",
  "-----BEGIN ENCRYPTED PRIVATE KEY-----",
  "-----BEGIN RSA PRIVATE KEY-----",
  "-----BEGIN EC PRIVATE KEY-----",
  "-----BEGIN DSA PRIVATE KEY-----",
  "-----BEGIN OPENSSH PRIVATE KEY-----",
] as const);

const ARCHIVE_EXTENSIONS = new Set([".zip", ".tar", ".gz"]);
const SENSITIVE_EXTENSION_SET = new Set<string>(SENSITIVE_EXTENSIONS);
const PRIVATE_KEY_HEADER_BYTES = PRIVATE_KEY_HEADERS.map((header) => Buffer.from(header, "ascii"));

export interface SourceSelectionCandidate {
  path: string;
  size?: number;
  /** At most the leading bytes are inspected; callers may pass a larger buffer safely. */
  contentPrefix?: Uint8Array;
}

interface BaseSelectionDecision {
  path: string;
}

export interface SelectedDecision extends BaseSelectionDecision {
  kind: "selected";
}

export interface FilteredByDefaultsDecision extends BaseSelectionDecision {
  kind: "filtered-by-defaults";
  reason: "filtered-by-defaults";
  detail: "analysis-data" | "archive" | "default-pattern";
}

export interface FilteredByIgnoreDecision extends BaseSelectionDecision {
  kind: "filtered-by-ignore";
  reason: "filtered-by-ignore";
  detail: "project-rule" | "cli-rule";
}

export interface SensitiveDecision extends BaseSelectionDecision {
  kind: "sensitive";
  reason: "sensitive";
  detail: "sensitive-extension" | "private-key-header";
  size?: number;
}

export type SourceSelectionDecision =
  | SelectedDecision
  | FilteredByDefaultsDecision
  | FilteredByIgnoreDecision
  | SensitiveDecision;

export interface SourceSelectionPolicyOptions {
  defaultPatterns?: readonly string[];
  projectPatterns?: readonly string[];
  cliPatterns?: readonly string[];
}

export interface SourceSelectionPolicy {
  readonly version: typeof SOURCE_SELECTION_POLICY_VERSION;
  readonly descriptors: readonly string[];
  decide(candidate: SourceSelectionCandidate): SourceSelectionDecision;
}

export interface SourceSelectionLedger {
  policyVersion: typeof SOURCE_SELECTION_POLICY_VERSION;
  candidates: number;
  selected: number;
  filteredByDefaults: number;
  filteredByIgnore: number;
  sensitive: number;
  entries: SourceSelectionDecision[];
}

function matcher(patterns: readonly string[]): Ignore {
  return ignore().add([...patterns]);
}

function normalizedPath(path: string): string {
  let normalized = path.replaceAll("\\", "/");
  while (normalized.startsWith("./")) normalized = normalized.slice(2);
  return normalized;
}

function isAnalysisDataPath(path: string): boolean {
  return path.split("/").some((segment) =>
    segment === ".excavator"
    || segment.startsWith(".excavator.")
    || segment.startsWith(".excavator-")
    || segment.startsWith(".trash-"),
  );
}

function isArchivePath(path: string): boolean {
  return ARCHIVE_EXTENSIONS.has(extname(path).toLowerCase());
}

function sensitiveExtension(path: string): boolean {
  return SENSITIVE_EXTENSION_SET.has(extname(path).toLowerCase());
}

function startsWithPrivateKeyHeader(prefix: Uint8Array | undefined): boolean {
  if (!prefix || prefix.byteLength === 0) return false;
  const bounded = prefix.subarray(0, PRIVATE_KEY_PREFIX_BYTES);
  return PRIVATE_KEY_HEADER_BYTES.some((header) => {
    if (bounded.byteLength < header.byteLength) return false;
    for (let index = 0; index < header.byteLength; index += 1) {
      if (bounded[index] !== header[index]) return false;
    }
    return true;
  });
}

function safeSize(size: number | undefined): number | undefined {
  return Number.isSafeInteger(size) && (size ?? -1) >= 0 ? size : undefined;
}

/**
 * Pure, versioned pre-extraction policy. It has no filesystem or logging
 * access: callers provide ordered rule sources and at most a bounded prefix.
 */
export function createSourceSelectionPolicy(
  options: SourceSelectionPolicyOptions = {},
): SourceSelectionPolicy {
  const defaultPatterns = [...(options.defaultPatterns ?? DEFAULT_IGNORE_PATTERNS)];
  const projectPatterns = [...(options.projectPatterns ?? [])];
  const cliPatterns = [...(options.cliPatterns ?? [])];
  const defaults = matcher(defaultPatterns);
  const throughProject = matcher([...defaultPatterns, ...projectPatterns]);
  const effective = matcher([...defaultPatterns, ...projectPatterns, ...cliPatterns]);
  const descriptors = Object.freeze([
    `policy:${SOURCE_SELECTION_POLICY_VERSION}`,
    ...defaultPatterns.map((pattern) => `default:${pattern}`),
    ...projectPatterns.map((pattern) => `project:${pattern}`),
    ...cliPatterns.map((pattern) => `cli:${pattern}`),
    `sensitive-extensions:${SENSITIVE_EXTENSIONS.join(",")}`,
    `private-key-prefix-bytes:${PRIVATE_KEY_PREFIX_BYTES}`,
    ...PRIVATE_KEY_HEADERS.map((header) => `private-key-header:${header}`),
  ]);

  return {
    version: SOURCE_SELECTION_POLICY_VERSION,
    descriptors,
    decide(candidate): SourceSelectionDecision {
      const path = normalizedPath(candidate.path);
      const size = safeSize(candidate.size);

      if (sensitiveExtension(path)) {
        return {
          kind: "sensitive",
          reason: "sensitive",
          detail: "sensitive-extension",
          path,
          ...(size === undefined ? {} : { size }),
        };
      }
      if (startsWithPrivateKeyHeader(candidate.contentPrefix)) {
        return {
          kind: "sensitive",
          reason: "sensitive",
          detail: "private-key-header",
          path,
          ...(size === undefined ? {} : { size }),
        };
      }
      if (isAnalysisDataPath(path)) {
        return { kind: "filtered-by-defaults", reason: "filtered-by-defaults", detail: "analysis-data", path };
      }
      if (isArchivePath(path)) {
        return { kind: "filtered-by-defaults", reason: "filtered-by-defaults", detail: "archive", path };
      }
      if (!effective.ignores(path)) return { kind: "selected", path };
      if (!throughProject.ignores(path)) {
        return { kind: "filtered-by-ignore", reason: "filtered-by-ignore", detail: "cli-rule", path };
      }
      if (!defaults.ignores(path)) {
        return { kind: "filtered-by-ignore", reason: "filtered-by-ignore", detail: "project-rule", path };
      }
      return { kind: "filtered-by-defaults", reason: "filtered-by-defaults", detail: "default-pattern", path };
    },
  };
}

export function buildSourceSelectionLedger(
  decisions: readonly SourceSelectionDecision[],
): SourceSelectionLedger {
  const paths = new Set<string>();
  let selected = 0;
  let filteredByDefaults = 0;
  let filteredByIgnore = 0;
  let sensitive = 0;

  for (const decision of decisions) {
    if (paths.has(decision.path)) {
      throw new Error(`buildSourceSelectionLedger: duplicate candidate path ${decision.path}`);
    }
    paths.add(decision.path);
    if (decision.kind === "selected") selected += 1;
    else if (decision.kind === "filtered-by-defaults") filteredByDefaults += 1;
    else if (decision.kind === "filtered-by-ignore") filteredByIgnore += 1;
    else if (decision.kind === "sensitive") sensitive += 1;
    else throw new Error("buildSourceSelectionLedger: unknown decision kind");
  }

  return {
    policyVersion: SOURCE_SELECTION_POLICY_VERSION,
    candidates: decisions.length,
    selected,
    filteredByDefaults,
    filteredByIgnore,
    sensitive,
    entries: decisions.map((decision) => ({ ...decision })),
  };
}

export function sourceSelectionConservationViolations(
  ledger: SourceSelectionLedger,
): string[] {
  const violations: string[] = [];
  const counted = ledger.selected + ledger.filteredByDefaults + ledger.filteredByIgnore + ledger.sensitive;
  if (counted !== ledger.candidates) {
    violations.push(`candidates=${ledger.candidates} but bucket-count=${counted}`);
  }
  if (ledger.entries.length !== ledger.candidates) {
    violations.push(`candidates=${ledger.candidates} but entries=${ledger.entries.length}`);
  }
  if (new Set(ledger.entries.map((entry) => entry.path)).size !== ledger.entries.length) {
    violations.push("selection entries contain duplicate paths");
  }
  const derived = { selected: 0, filteredByDefaults: 0, filteredByIgnore: 0, sensitive: 0 };
  for (const entry of ledger.entries) {
    if (entry.kind === "selected") derived.selected += 1;
    else if (entry.kind === "filtered-by-defaults") derived.filteredByDefaults += 1;
    else if (entry.kind === "filtered-by-ignore") derived.filteredByIgnore += 1;
    else if (entry.kind === "sensitive") derived.sensitive += 1;
  }
  for (const key of Object.keys(derived) as Array<keyof typeof derived>) {
    if (derived[key] !== ledger[key]) {
      violations.push(`${key}=${ledger[key]} but entries=${derived[key]}`);
    }
  }
  return violations;
}
