import { FrameworkConfigSchema } from "./types.js";
import type { FrameworkConfig } from "./types.js";
import { builtinFrameworkConfigs } from "./frameworks/index.js";
import { maskManifestText } from "./manifest-mask.js";

/** A framework found in the declared manifests, with the first place it was seen. */
export interface FrameworkDetection {
  id: string;
  /** Number of manifest files with at least one keyword hit. */
  manifests: number;
  /** First hit: the first file in stable path order that has one, its earliest keyword. */
  evidence: { path: string; line: number; keyword: string };
}

/**
 * A `*.ext` manifest matches any path ending with `.ext` (e.g. `*.csproj` for
 * arbitrarily-named MSBuild projects); otherwise it is an exact name or a
 * path suffix after `/`.
 */
function matchesManifestFile(manifestFile: string, path: string): boolean {
  return manifestFile.startsWith("*.")
    ? path.endsWith(manifestFile.slice(1))
    : path === manifestFile || path.endsWith(`/${manifestFile}`);
}

/** UTF-16 code-unit order: independent of the process locale. */
function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Registry for framework configurations. Provides detection of frameworks
 * from manifest file contents and lookup by id or language.
 */
export class FrameworkRegistry {
  private byId = new Map<string, FrameworkConfig>();
  private byLanguage = new Map<string, FrameworkConfig[]>();

  register(config: FrameworkConfig): void {
    const parsed = FrameworkConfigSchema.parse(config);

    // Prevent duplicate registration
    if (this.byId.has(parsed.id)) return;

    this.byId.set(parsed.id, parsed);

    for (const lang of parsed.languages) {
      const existing = this.byLanguage.get(lang) ?? [];
      existing.push(parsed);
      this.byLanguage.set(lang, existing);
    }
  }

  getById(id: string): FrameworkConfig | null {
    return this.byId.get(id) ?? null;
  }

  getForLanguage(langId: string): FrameworkConfig[] {
    return [...(this.byLanguage.get(langId) ?? [])];
  }

  getAllFrameworks(): FrameworkConfig[] {
    return [...this.byId.values()];
  }

  /** True when some registered framework declares a manifest that matches `path`. */
  isManifestPath(path: string): boolean {
    for (const config of this.byId.values()) {
      if (config.manifestFiles.some((manifestFile) => matchesManifestFile(manifestFile, path))) return true;
    }
    return false;
  }

  /**
   * Detect frameworks from manifest file contents.
   * @param manifests - Map of filename to file content (e.g., { "requirements.txt": "django==4.2\n..." })
   * @returns Array of detected FrameworkConfig objects, in registration order
   */
  detectFrameworks(manifests: Record<string, string>): FrameworkConfig[] {
    const detected = new Set(
      this.detectWithEvidence(
        Object.entries(manifests).map(([path, content]) => ({ path, content })),
      ).map((detection) => detection.id),
    );
    return [...this.byId.values()].filter((config) => detected.has(config.id));
  }

  /**
   * Detect frameworks from every manifest file, with the first piece of
   * evidence for each. A keyword counts only outside comments and exclusion
   * declarations (see maskManifestText), matched case-insensitively as a
   * substring. The result does not depend on the order of `files`.
   * @param files - Manifest files: project-relative path and content
   * @returns One entry per detected framework, sorted by id
   */
  detectWithEvidence(files: Array<{ path: string; content: string }>): FrameworkDetection[] {
    const sorted = [...files].sort((a, b) => compareCodeUnits(a.path, b.path));
    // Masked, lower-cased text per file: masking keeps line breaks, so a line
    // number counted in it is the line of the original text.
    const textCache = new Map<number, string>();
    const textOf = (index: number): string => {
      let text = textCache.get(index);
      if (text === undefined) {
        text = maskManifestText(sorted[index].path, sorted[index].content).toLowerCase();
        textCache.set(index, text);
      }
      return text;
    };

    const results: FrameworkDetection[] = [];
    for (const config of this.byId.values()) {
      const keywords = config.detectionKeywords.map((keyword) => ({ keyword, lower: keyword.toLowerCase() }));
      let manifests = 0;
      let evidence: FrameworkDetection["evidence"] | undefined;

      for (let index = 0; index < sorted.length; index++) {
        const file = sorted[index];
        if (!config.manifestFiles.some((manifestFile) => matchesManifestFile(manifestFile, file.path))) continue;

        const text = textOf(index);
        // Earliest hit over all keywords; a tie keeps the keyword listed first.
        let hit: { offset: number; keyword: string } | undefined;
        for (const { keyword, lower } of keywords) {
          const offset = text.indexOf(lower);
          if (offset >= 0 && (hit === undefined || offset < hit.offset)) hit = { offset, keyword };
        }
        if (!hit) continue;

        manifests++;
        evidence ??= {
          path: file.path,
          line: 1 + countNewlines(text, hit.offset),
          keyword: hit.keyword,
        };
      }

      if (evidence) results.push({ id: config.id, manifests, evidence });
    }

    return results.sort((a, b) => compareCodeUnits(a.id, b.id));
  }

  /**
   * Create a registry pre-populated with all built-in framework configs.
   */
  static createDefault(): FrameworkRegistry {
    const registry = new FrameworkRegistry();
    for (const config of builtinFrameworkConfigs) {
      registry.register(config);
    }
    return registry;
  }
}

/** Number of `\n` characters in `text` before `end`. */
function countNewlines(text: string, end: number): number {
  let count = 0;
  for (let at = text.indexOf("\n"); at >= 0 && at < end; at = text.indexOf("\n", at + 1)) count++;
  return count;
}
