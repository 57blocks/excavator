/**
 * The source languages the system facts count (system-facts.mjs): a file
 * extension names a language. Only files in these languages are counted as
 * source files of an application; data and configuration files (json, yaml,
 * xml, lock files, documents) are not source and are not counted.
 */

const BY_LANGUAGE = {
  TypeScript: ['ts', 'tsx', 'mts', 'cts'],
  JavaScript: ['js', 'jsx', 'mjs', 'cjs'],
  Vue: ['vue'],
  Svelte: ['svelte'],
  Go: ['go'],
  Java: ['java'],
  Kotlin: ['kt', 'kts'],
  Scala: ['scala'],
  Groovy: ['groovy'],
  Python: ['py'],
  Ruby: ['rb'],
  PHP: ['php'],
  'C#': ['cs'],
  'F#': ['fs'],
  'Visual Basic': ['vb'],
  Rust: ['rs'],
  Swift: ['swift'],
  'Objective-C': ['m', 'mm'],
  Dart: ['dart'],
  C: ['c', 'h'],
  'C++': ['cc', 'cpp', 'cxx', 'hpp'],
  Lua: ['lua'],
  Perl: ['pl', 'pm'],
  Elixir: ['ex', 'exs'],
  Erlang: ['erl'],
  Clojure: ['clj', 'cljs'],
  Haskell: ['hs'],
  Shell: ['sh', 'bash'],
  SQL: ['sql'],
  HTML: ['html', 'htm'],
  JSP: ['jsp'],
  CSS: ['css'],
  Sass: ['scss', 'sass'],
  Less: ['less'],
  GraphQL: ['graphql', 'gql'],
  'Protocol Buffers': ['proto'],
  Terraform: ['tf'],
};

const BY_EXTENSION = new Map(Object.entries(BY_LANGUAGE).flatMap(([language, extensions]) => extensions.map((extension) => [extension, language])));

/** The language of a project-relative path by its extension (case-insensitive), or null when the extension is not a source language. */
export function languageOf(path) {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const at = name.lastIndexOf('.');
  if (at <= 0) return null;
  return BY_EXTENSION.get(name.slice(at + 1).toLowerCase()) ?? null;
}
