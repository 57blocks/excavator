import ignore, { type Ignore } from "ignore";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * The hand-written exclusions. A pattern ending in `/` is a directory
 * pattern; any other is a file pattern.
 */
const BASE_IGNORE_PATTERNS: readonly string[] = [
  // Dependency directories
  "node_modules/",
  ".git/",
  ".svn/",
  ".hg/",
  "vendor/",
  "venv/",
  ".venv/",
  "__pycache__/",

  // Build output
  "dist/",
  "build/",
  "out/",
  "coverage/",
  ".next/",
  ".cache/",
  ".turbo/",
  "target/",
  "obj/",

  // Lock files
  "*.lock",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",

  // Binary/asset files
  "*.png",
  "*.jpg",
  "*.jpeg",
  "*.gif",
  "*.svg",
  "*.ico",
  "*.woff",
  "*.woff2",
  "*.ttf",
  "*.eot",
  "*.mp3",
  "*.mp4",
  "*.pdf",
  "*.zip",
  "*.tar",
  "*.gz",

  // Generated files
  "*.min.js",
  "*.min.css",
  "*.map",
  "*.generated.*",

  // IDE/editor
  ".idea/",
  ".vscode/",

  // Operating-system metadata
  ".DS_Store",
  "._*",
  "__MACOSX/",
  "Thumbs.db",
  "ehthumbs.db",
  "ehthumbs_vista.db",
  "Desktop.ini",
  "$RECYCLE.BIN/",
  "System Volume Information/",

  // Unambiguous IDE/tool caches
  ".vs/",
  ".gradle/",

  // Misc
  "LICENSE",
  ".gitignore",
  ".excavatorignore",
  ".editorconfig",
  ".prettierrc",
  ".eslintrc*",
  "*.log",

  // AI agent/plugin directories (own tooling, never analysis input) and this
  // project's own data directory (would otherwise self-reference its output)
  ".claude/",
  ".agents/",
  ".codex/",
  ".excavator/",

  // Stray `.excavator` variant/backup directories (e.g. a manual
  // `.excavator.slicec-bak/` snapshot or an `.excavator-old/` rename) and
  // `.trash-*/` recycle directories (see skills/excavator/SKILL.md's Phase 7
  // delayed-purge step) — same reasoning as `.excavator/` above: never
  // analysis input. Directory patterns only (trailing `/`), so the
  // `.excavatorignore` FILE (no trailing slash, and no literal `.` or `-`
  // right after "excavator") is never matched by these — it stays a real
  // ignore-rules source, read directly by createIgnoreFilter below.
  ".excavator.*/",
  ".excavator-*/",
  ".trash-*/",
];

function isFilePattern(pattern: string): boolean {
  return !pattern.endsWith("/") && !pattern.startsWith("!");
}

function isDirectoryPattern(pattern: string): boolean {
  return pattern.endsWith("/") && !pattern.startsWith("!");
}

/**
 * Conservative universal exclusions shared by every source consumer.
 *
 * Under gitignore semantics a file pattern also matches a directory of the
 * same name at any depth, and the `ignore` package matches case-insensitively,
 * so `LICENSE` alone would drop a `license/` source package. Each file pattern
 * therefore gets a derived `!<pattern>/` that withdraws only its directory
 * match; files are still tested one by one, so `license/LICENSE` stays
 * excluded. The list is ordered file patterns, negations, directory patterns:
 * the positive patterns do not depend on each other's order, and for one path
 * the last matching rule wins, so a directory a directory pattern names
 * (`.trash-1.log/`) stays excluded even when a file pattern also matches its
 * name. A parent a directory pattern excludes (`node_modules/`, `build/`) is
 * decided before its children, so nothing under it comes back. Project and
 * CLI rules are added after all of these and still apply.
 */
export const DEFAULT_IGNORE_PATTERNS: string[] = [
  ...BASE_IGNORE_PATTERNS.filter(isFilePattern),
  ...BASE_IGNORE_PATTERNS.filter(isFilePattern).map((pattern) => `!${pattern}/`),
  ...BASE_IGNORE_PATTERNS.filter(isDirectoryPattern),
];

export interface IgnoreFilter {
  /** Returns true if the given relative path should be excluded from analysis. */
  isIgnored(relativePath: string): boolean;
}

/**
 * Creates an IgnoreFilter that merges hardcoded defaults with user-defined
 * patterns from the root .excavatorignore and CLI-provided exclude patterns.
 *
 * Pattern load order (later entries can override earlier ones via ! negation):
 * 1. Hardcoded defaults
 * 2. .excavatorignore at project root (if exists)
 * 3. CLI --exclude patterns (highest priority)
 */
export function createIgnoreFilter(projectRoot: string, extraPatterns: string[] = []): IgnoreFilter {
  const ig: Ignore = ignore();

  // Layer 1: hardcoded defaults
  ig.add(DEFAULT_IGNORE_PATTERNS);

  // Layer 2: .excavatorignore at project root
  const rootIgnorePath = join(projectRoot, ".excavatorignore");
  if (existsSync(rootIgnorePath)) {
    const content = readFileSync(rootIgnorePath, "utf-8");
    ig.add(content);
  }

  // Layer 3: CLI --exclude patterns (highest priority)
  if (extraPatterns.length > 0) {
    ig.add(extraPatterns);
  }

  return {
    isIgnored(relativePath: string): boolean {
      return ig.ignores(relativePath.replaceAll("\\", "/"));
    },
  };
}
