import { z } from "zod";

// Tree-sitter grammar configuration for a language.
// Only wasmPackage and wasmFile are needed for grammar loading.
// The extraction logic in tree-sitter-plugin.ts is currently TS/JS-specific;
// when grammars for other languages are added, language-specific extractors
// should be registered via the customAnalyzer escape hatch.
export const TreeSitterConfigSchema = z.object({
  wasmPackage: z.string(),
  wasmFile: z.string(),
});

export type TreeSitterConfig = z.infer<typeof TreeSitterConfigSchema>;

// File pattern conventions for a language
export const FilePatternConfigSchema = z.object({
  entryPoints: z.array(z.string()),
  barrels: z.array(z.string()),
  tests: z.array(z.string()),
  config: z.array(z.string()),
});

export type FilePatternConfig = z.infer<typeof FilePatternConfigSchema>;

// Complete language configuration (base schema — used by LanguageRegistry.register())
export const LanguageConfigSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  extensions: z.array(z.string()),
  filenames: z.array(z.string()).optional(),
  basenamePatterns: z.array(z.string().min(1)).optional(),
  treeSitter: TreeSitterConfigSchema.optional(),
  concepts: z.array(z.string()),
  filePatterns: FilePatternConfigSchema,
});

export type LanguageConfig = z.infer<typeof LanguageConfigSchema>;

/**
 * Strict schema with refinement: ensures at least one extension, filename, or
 * basename pattern is provided so the config can actually be detected by the
 * registry.
 * Use this for validating new/user-supplied configs (some builtin configs like
 * kubernetes/github-actions intentionally lack all three and rely on future
 * content-based detection).
 */
export const StrictLanguageConfigSchema = LanguageConfigSchema.refine(
  (c) => c.extensions.length > 0
    || (c.filenames !== undefined && c.filenames.length > 0)
    || (c.basenamePatterns !== undefined && c.basenamePatterns.length > 0),
  { message: "LanguageConfig must have at least one extension, filename, or basename pattern for detection" }
);

const nameList = z.array(z.string().min(1));

// Declarative route-registration rules, read by plugins/route-facts.ts. Strict:
// an unknown key or a missing required field makes registration fail.
export const RouteRulesSchema = z.object({
  // The file is read only when it names one of these modules (an import source
  // or, for TS/JS, a require() string literal). Exact match.
  importSources: nameList.min(1),
  kind: z.enum(["http", "ui"]),
  // How a path joins the prefix it is registered under.
  join: z.enum(["append", "nested"]),
  receivers: z.object({
    // A local assigned from a call to one of these callees is a root (prefix "").
    rootFactories: nameList.optional(),
    // A local assigned from a call to one of these callees is a router.
    routerFactories: nameList.optional(),
    // A parameter whose declared type is one of these is a root.
    rootParamTypes: nameList.optional(),
    // A parameter whose declared type is one of these sits under an unknown prefix.
    prefixParamTypes: nameList.optional(),
    // x := recv.<method>(path, ...) makes x a receiver under recv's prefix + path.
    groupMethods: nameList.optional(),
  }).strict().optional(),
  // recv.<verb>(path, ..., handler): verb text -> method.
  calls: z.object({
    verbs: z.record(z.string().min(1), z.string().min(1)),
    pathArgument: z.number().int().nonnegative(),
  }).strict().optional(),
  // recv.<method>(path?, target): target is mounted under recv's prefix + path.
  mounts: z.object({ methods: nameList.min(1) }).strict().optional(),
  // JSX: <Tag pathAttribute=... handlerAttributes...>children</Tag>
  elements: z.object({
    tags: nameList.min(1),
    pathAttribute: z.string().min(1),
    indexAttribute: z.string().min(1).optional(),
    handlerAttributes: nameList,
    // An element of one of these tags makes its descendants roots.
    rootTags: nameList.optional(),
  }).strict().optional(),
  // Route objects: { pathKey, handlerKeys..., childrenKey: [...] }.
  objects: z.object({
    pathKey: z.string().min(1),
    indexKey: z.string().min(1).optional(),
    handlerKeys: nameList,
    childrenKey: z.string().min(1),
    // A variable whose type annotation names one of these types holds route objects.
    containerTypes: nameList.optional(),
    // An array passed to a call of one of these callees holds root route objects.
    rootFactories: nameList.optional(),
  }).strict().optional(),
}).strict();

export type RouteRules = z.infer<typeof RouteRulesSchema>;

// Framework configuration
export const FrameworkConfigSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  languages: z.array(z.string().min(1)).min(1),
  detectionKeywords: z.array(z.string()).min(1),
  manifestFiles: z.array(z.string()).min(1),
  promptSnippetPath: z.string().min(1),
  entryPoints: z.array(z.string()).optional(),
  layerHints: z.record(z.string(), z.string()).optional(),
  routes: RouteRulesSchema.optional(),
});

export type FrameworkConfig = z.infer<typeof FrameworkConfigSchema>;
