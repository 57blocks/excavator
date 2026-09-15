import ignore, { type Ignore } from "ignore";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { resolveDataDir } from "./persistence/index.js";

/**
 * Hardcoded default ignore patterns matching the project-scanner agent's
 * exclusion rules, plus bin/obj for .NET projects.
 */
export const DEFAULT_IGNORE_PATTERNS: string[] = [
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

export interface IgnoreFilter {
  /** Returns true if the given relative path should be excluded from analysis. */
  isIgnored(relativePath: string): boolean;
}

/**
 * Creates an IgnoreFilter that merges hardcoded defaults with user-defined
 * patterns from .excavatorignore files and CLI-provided exclude patterns.
 *
 * Pattern load order (later entries can override earlier ones via ! negation):
 * 1. Hardcoded defaults
 * 2. <project>/.excavator/.excavatorignore (if exists)
 * 3. .excavatorignore at project root (if exists)
 * 4. CLI --exclude patterns (highest priority)
 */
export function createIgnoreFilter(projectRoot: string, extraPatterns: string[] = []): IgnoreFilter {
  const ig: Ignore = ignore();

  // Layer 1: hardcoded defaults
  ig.add(DEFAULT_IGNORE_PATTERNS);

  // Layer 2: <project>/.excavator/.excavatorignore
  const projectIgnorePath = join(resolveDataDir(projectRoot), ".excavatorignore");
  if (existsSync(projectIgnorePath)) {
    const content = readFileSync(projectIgnorePath, "utf-8");
    ig.add(content);
  }

  // Layer 3: .excavatorignore at project root
  const rootIgnorePath = join(projectRoot, ".excavatorignore");
  if (existsSync(rootIgnorePath)) {
    const content = readFileSync(rootIgnorePath, "utf-8");
    ig.add(content);
  }

  // Layer 4: CLI --exclude patterns (highest priority)
  if (extraPatterns.length > 0) {
    ig.add(extraPatterns);
  }

  return {
    isIgnored(relativePath: string): boolean {
      return ig.ignores(relativePath);
    },
  };
}
