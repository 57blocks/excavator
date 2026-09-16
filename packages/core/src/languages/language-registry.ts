import { LanguageConfigSchema } from "./types.js";
import type { LanguageConfig } from "./types.js";
import { builtinLanguageConfigs } from "./configs/index.js";

/**
 * Registry for language configurations. Maps language ids and file extensions
 * to their corresponding LanguageConfig objects.
 */
export class LanguageRegistry {
  private byId = new Map<string, LanguageConfig>();
  private byExtension = new Map<string, LanguageConfig>();
  private byFilename = new Map<string, LanguageConfig>();
  private byBasenamePattern: Array<{ matcher: RegExp; config: LanguageConfig }> = [];

  register(config: LanguageConfig): void {
    const parsed = LanguageConfigSchema.parse(config);
    this.byId.set(parsed.id, parsed);
    for (const ext of parsed.extensions) {
      // Normalize: strip leading dot if present for lookup consistency
      const key = ext.startsWith(".") ? ext : `.${ext}`;
      this.byExtension.set(key, parsed);
    }
    if (parsed.filenames) {
      for (const filename of parsed.filenames) {
        this.byFilename.set(filename.toLowerCase(), parsed);
      }
    }
    if (parsed.basenamePatterns) {
      for (const pattern of parsed.basenamePatterns) {
        this.byBasenamePattern.push({ matcher: compileBasenamePattern(pattern), config: parsed });
      }
    }
  }

  getById(id: string): LanguageConfig | null {
    return this.byId.get(id) ?? null;
  }

  getByExtension(ext: string): LanguageConfig | null {
    const key = (ext.startsWith(".") ? ext : `.${ext}`).toLowerCase();
    return this.byExtension.get(key) ?? null;
  }

  getForFile(filePath: string): LanguageConfig | null {
    // Deterministic precedence: exact filename, basename pattern, extension.
    const basename = filePath.split("/").pop() ?? filePath;
    const filenameMatch = this.byFilename.get(basename.toLowerCase());
    if (filenameMatch) return filenameMatch;
    const patternMatch = this.byBasenamePattern.find(({ matcher }) => matcher.test(basename));
    if (patternMatch) return patternMatch.config;
    const lastDot = filePath.lastIndexOf(".");
    if (lastDot === -1) return null;
    const ext = filePath.slice(lastDot).toLowerCase();
    return this.getByExtension(ext);
  }

  getAllLanguages(): LanguageConfig[] {
    return [...this.byId.values()];
  }

  /**
   * Create a registry pre-populated with all built-in language configs.
   */
  static createDefault(): LanguageRegistry {
    const registry = new LanguageRegistry();
    for (const config of builtinLanguageConfigs) {
      registry.register(config);
    }
    return registry;
  }
}

function compileBasenamePattern(pattern: string): RegExp {
  const escaped = pattern.replace(/[|\\{}()[\]^$+?.]/g, "\\$&").replaceAll("*", ".*");
  return new RegExp(`^${escaped}$`);
}
