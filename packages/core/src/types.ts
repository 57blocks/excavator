// Node types (27 total: 5 code + 8 non-code + 3 domain + 5 knowledge + 6 design)
export type NodeType =
  | "file" | "function" | "class" | "module" | "concept"
  | "config" | "document" | "service" | "table" | "endpoint"
  | "pipeline" | "schema" | "resource"
  | "domain" | "flow" | "step"
  | "article" | "entity" | "topic" | "claim" | "source"
  | "page" | "screen" | "component" | "componentSet" | "instance" | "token";

// Edge types (38 total in 9 categories: Structural, Behavioral, Data flow, Dependencies, Semantic, Infrastructure/Schema, Domain, Knowledge, Design)
export type EdgeType =
  | "imports" | "exports" | "contains" | "inherits" | "implements"  // Structural
  | "calls" | "subscribes" | "publishes" | "middleware"              // Behavioral
  | "reads_from" | "writes_to" | "transforms" | "validates"         // Data flow
  | "depends_on" | "tested_by" | "configures"                       // Dependencies
  | "related" | "similar_to"                                         // Semantic
  | "deploys" | "serves" | "provisions" | "triggers"                // Infrastructure
  | "migrates" | "documents" | "routes" | "defines_schema"          // Schema/Data
  | "contains_flow" | "flow_step" | "cross_domain"                  // Domain
  | "cites" | "contradicts" | "builds_on" | "exemplifies" | "categorized_under" | "authored_by" // Knowledge
  | "instance_of" | "variant_of" | "uses_token"; // Design

// Optional knowledge metadata for article/entity/topic/claim/source nodes
export interface KnowledgeMeta {
  wikilinks?: string[];
  backlinks?: string[];
  category?: string;
  content?: string;
}

// Optional domain metadata for domain/flow/step nodes
export interface DomainMeta {
  entities?: string[];
  businessRules?: string[];
  crossDomainInteractions?: string[];
  entryPoint?: string;
  entryType?: "http" | "cli" | "event" | "cron" | "manual";
}

// Optional Figma metadata for page/screen/component/componentSet/instance/token nodes
export interface FigmaMeta {
  fileKey?: string;
  nodeId?: string;            // Figma node id, e.g. "1:23"
  figmaType?: string;         // FRAME | COMPONENT | COMPONENT_SET | INSTANCE | TEXT ...
  dimensions?: { width: number; height: number };
  tokenKind?: "color" | "type" | "spacing" | "effect" | "grid";
  tokenValue?: string;        // e.g. "#0A84FF", "16px"
  prototypeTargets?: string[]; // roadmap B — recorded now, edges later
  componentKey?: string;       // roadmap C — recorded now
}

// ---------------------------------------------------------------------------
// Attribution model (v2): every edge says where it came from, every anchored
// node says how its anchor was obtained, every summary says whether it was
// checked against the source.
// ---------------------------------------------------------------------------

/** Where an evidence line came from. `model` means a model pointed at the
 *  line; a deterministic reader produced every other kind. */
export type EvidenceSource = "tree-sitter" | "import-map" | "rule" | "model";

/** One citation: a file and the line in it that carries the cited token. */
export interface Evidence {
  file: string;
  line: number;
  endLine?: number;
  source: EvidenceSource;
  /** Optional verbatim slice of the cited line, for display only. */
  text?: string;
}

/** `extracted` = a reader produced this edge from a cited line.
 *  `inferred` = judgement, with no non-model evidence behind it. */
export type EdgeProvenance = "extracted" | "inferred";

/** How a node's `lineRange`/`filePath` anchor was obtained. `census` means the
 *  node is the file itself, so the anchor is the path with no line claim. */
export type AnchorSource = "tree-sitter" | "rule" | "census";

/** Result of checking a statement against the source it claims to describe.
 *  `dirty` = the source changed since the statement was checked. */
export type VerificationState = "verified" | "unverified" | "contradicted" | "dirty";

/** A named hole in the knowledge: something the pipeline could not resolve,
 *  counted rather than dropped. */
export interface Gap {
  kind: string;
  scope: string;
  reason: string;
  count: number;
  samples?: string[];
}

/** Why a scanned file did not end up parsed. The first six are scan-time
 *  reasons (the file was never handed to a reader); the last two are
 *  extraction outcomes. They share one map so the per-language conservation
 *  identity `files = parsed + zeroSymbol + Σ skipped` covers every input. */
export type SkipReason =
  | "symlink" | "read-failed" | "unknown-language" | "binary" | "too-large" | "ignored"
  | "no-extractor" | "parse-failed";

/** Declaration counts a language contributed to the graph. */
export interface CoverageKinds {
  function: number;
  class: number;
  import: number;
  export: number;
  call: number;
}

export interface LanguageCoverage {
  files: number;
  parsed: number;
  zeroSymbol: number;
  /** Skip counts by reason. Absent reason = zero. */
  skipped: Partial<Record<SkipReason, number>>;
  kinds: CoverageKinds;
}

/** Size thresholds the scanner applied, published so the `too-large` bucket is
 *  interpretable. */
export interface CoverageLimits {
  maxFileLines: number;
  maxFileBytes: number;
}

/** Per-language ledger of what was read and what was not. Conservation holds:
 *  `files = parsed + zeroSymbol + Σ skipped[reason]`. */
export interface Coverage {
  files: number;
  byLanguage: Record<string, LanguageCoverage>;
  ignored: number;
  limits?: CoverageLimits;
}

// GraphNode with 27 types: 5 code + 8 non-code + 3 domain + 5 knowledge + 6 design
export interface GraphNode {
  id: string;
  type: NodeType;
  name: string;
  filePath?: string;
  lineRange?: [number, number];
  /** Declaring scope: receiver type, enclosing class/trait/enum/object, or
   *  object-literal binding name. Absent for free declarations and files. */
  owner?: string;
  anchorSource?: AnchorSource;
  /** MAY be empty: "not summarised" is a visible state, not an absence. */
  summary: string;
  /** Verdict of checking `summary` against the source inside `lineRange`. */
  verification?: VerificationState;
  tags: string[];
  complexity: "simple" | "moderate" | "complex";
  languageNotes?: string;
  domainMeta?: DomainMeta;
  knowledgeMeta?: KnowledgeMeta;
  figmaMeta?: FigmaMeta;
}

// GraphEdge with rich relationship modeling
export interface GraphEdge {
  source: string;
  target: string;
  type: EdgeType;
  direction: "forward" | "backward" | "bidirectional";
  description?: string;
  /** Per-edge-type ORDERING CONSTANT. NOT a confidence score — attribution
   *  lives in `provenance`/`evidence`. */
  weight: number; // 0-1
  /** Cited lines. Optional: a graph produced by the existing pipeline states
   *  neither of these, and validation accepts that unchanged. When they ARE
   *  present, `auditGraphShape` checks the discipline — an `extracted` edge
   *  should carry at least one entry whose `source` is not `model`, and an
   *  `inferred` edge should carry no non-model entry — and reports a WARNING,
   *  never a rejection. */
  evidence?: Evidence[];
  provenance?: EdgeProvenance;
  /** Set by the graph validator when it re-reads the evidence line. */
  verification?: VerificationState;
}

// Layer (logical grouping)
export interface Layer {
  id: string;
  name: string;
  description: string;
  nodeIds: string[];
}

// TourStep (for learn mode)
export interface TourStep {
  order: number;
  title: string;
  description: string;
  nodeIds: string[];
  languageLesson?: string;
}

// ProjectMeta
export interface ProjectMeta {
  name: string;
  languages: string[];
  frameworks: string[];
  description: string;
  analyzedAt: string;
  /** `null` when the analysed target is not a git repository (or is a
   *  multi-repo parent directory); `sourceDigest` identifies it instead. */
  gitCommitHash: string | null;
  /** sha256 over the scanned source content. Written by the scan. */
  sourceDigest?: string;
  /** sha256 over the canonical deterministic facts graph. */
  factsDigest?: string;
  /** Version of the deterministic pipeline that produced the facts. */
  pipelineVersion?: string;
  /** Host-reported model name for the prose half, or `unknown`. */
  model?: string;
}

export interface SemanticLanguageAuditField {
  fieldPath: string;
  maskedSourceSpans?: string[];
  reason?: "noncanonical-language";
  unverifiedSpans?: string[];
}

export interface SemanticLanguageAudit {
  status: "accepted" | "rejected";
  inspected: number;
  accepted: SemanticLanguageAuditField[];
  rejected: SemanticLanguageAuditField[];
}

// Root KnowledgeGraph
export interface KnowledgeGraph {
  version: string;
  /** Present on persisted model-semantic products; writers currently fix it to English. */
  contentLanguage?: string;
  /** Deterministic terminal buckets for every persisted model-owned prose field. */
  languageAudit?: SemanticLanguageAudit;
  kind?: "codebase" | "knowledge" | "design";
  project: ProjectMeta;
  nodes: GraphNode[];
  edges: GraphEdge[];
  layers: Layer[];
  tour: TourStep[];
  /** Per-language ledger. Absent only in the pre-v2 shape; `validateGraph`
   *  defaults it to an empty ledger. */
  coverage?: Coverage;
  /** Named holes, counted. Same defaulting rule as `coverage`. */
  gaps?: Gap[];
}

// AnalysisMeta (for persistence)
export interface AnalysisMeta {
  lastAnalyzedAt: string;
  gitCommitHash: string;
  version: string;
  analyzedFiles: number;
}

// Project config (for auto-update opt-in and language preference)
export interface ProjectConfig {
  autoUpdate: boolean;
  outputLanguage?: string;
}

// Non-code structural sub-interfaces
export interface SectionInfo {
  name: string;
  level: number;
  lineRange: [number, number];
}

export interface DefinitionInfo {
  name: string;
  /** Parser-reported definition kind. Known values: "table", "view", "index", "message", "enum", "type", "input", "interface", "union", "scalar", "variable", "output", "resource", "data", "section", "target", "stage", "dependency", "property", "code-behind", "datatype", "element", "binding", "command" */
  kind: string;
  lineRange: [number, number];
  fields: string[];
}

export interface ServiceInfo {
  name: string;
  image?: string;
  ports: number[];
  lineRange?: [number, number];
}

export interface EndpointInfo {
  method?: string;
  path: string;
  lineRange: [number, number];
}

export interface StepInfo {
  name: string;
  lineRange: [number, number];
}

export interface ResourceInfo {
  name: string;
  kind: string;
  lineRange: [number, number];
}

export interface ReferenceResolution {
  source: string;
  target: string;
  referenceType: string; // "file", "image", "schema", "service"
  line?: number;
}

// Plugin interfaces
export interface StructuralAnalysis {
  functions: Array<{
    name: string;
    lineRange: [number, number];
    params: string[];
    returnType?: string;
    /** Declaring type/scope; empty means free function, null means unresolved.
     * Omitted by extractors that only represent methods in classes[].methods. */
    owner?: string | null;
  }>;
  classes: Array<{ name: string; lineRange: [number, number]; methods: string[]; properties: string[] }>;
  imports: Array<{ source: string; specifiers: string[]; lineNumber: number }>;
  exports: Array<{ name: string; lineNumber: number; isDefault?: boolean }>;
  // Non-code structural data (all optional for backward compat)
  sections?: SectionInfo[];
  definitions?: DefinitionInfo[];
  services?: ServiceInfo[];
  endpoints?: EndpointInfo[];
  steps?: StepInfo[];
  resources?: ResourceInfo[];
}

export interface ImportResolution {
  source: string;
  resolvedPath: string;
  specifiers: string[];
}

export interface CallGraphEntry {
  caller: string;
  callee: string;
  lineNumber: number;
}

export interface AnalyzerPlugin {
  name: string;
  languages: string[];
  analyzeFile(filePath: string, content: string): StructuralAnalysis;
  resolveImports?(filePath: string, content: string): ImportResolution[];
  extractCallGraph?(filePath: string, content: string): CallGraphEntry[];
  extractReferences?(filePath: string, content: string): ReferenceResolution[];
  /**
   * Optional single-parse fast path returning both structure and call graph.
   * Plugins that parse source (e.g. tree-sitter) can implement this to avoid
   * parsing the same file twice when a caller needs both. Output must equal
   * `analyzeFile` + `extractCallGraph` called separately.
   */
  analyzeFileFull?(
    filePath: string,
    content: string,
  ): { structure: StructuralAnalysis; callGraph: CallGraphEntry[] };
}
