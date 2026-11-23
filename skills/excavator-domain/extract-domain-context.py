#!/usr/bin/env python3
"""
extract-domain-context.py — Lightweight codebase scanner for domain knowledge extraction.

Scans a project directory and produces a structured JSON context file that the
domain-analyzer agent uses to identify business domains, flows, and steps.

HTTP and UI entry points come from the fact graph (`knowledge-graph.jsonl`, the
`entryPoint` records the deterministic build resolves), never from regexes. The
regexes that used to find HTTP routes only flag code that looks like a route or
handler registration the facts do not account for (`unrecognisedFiles`); CLI,
event, cron and exported-handler entry points still come from patterns.

Usage:
    python extract-domain-context.py <project-root>

Output:
    .excavator/intermediate/domain-context.json
"""

import json
import os
import re
import sys
from pathlib import Path
from typing import Any


def resolve_data_dir(root: Path) -> Path:
    """The project's data directory -- single source of truth: `.excavator/`."""
    return root / ".excavator"

# ── Configuration ──────────────────────────────────────────────────────────

# No model reads this file whole: split-domain-areas.mjs cuts it into bounded
# areas. The caps that remain only guard pathological trees, and every one of
# them is counted under `truncated` in the output, never applied silently.
MAX_FILE_TREE_DEPTH = 12
MAX_FILES_TOTAL = 20000
MAX_LINES_PER_FILE = 80
MAX_ENTRY_POINTS = 5000
MAX_PREVIEW_CHARS = 300

# File extensions we care about for domain analysis
SOURCE_EXTENSIONS = {
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
    ".py", ".pyi",
    ".go",
    ".rs",
    ".java", ".kt", ".scala",
    ".rb",
    ".cs",
    ".php",
    ".swift",
    ".c", ".cpp", ".h", ".hpp",
    ".ex", ".exs",
    ".hs",
    ".lua",
    ".r", ".R",
}

# Directories to always skip
SKIP_DIRS = {
    "node_modules", ".git", ".svn", ".hg", "__pycache__", ".tox",
    "venv", ".venv", "env", ".env", "dist", "build", "out", ".next",
    ".nuxt", "target", "vendor", ".idea", ".vscode", "coverage",
    ".excavator", ".pytest_cache", ".mypy_cache",
    "Pods", "DerivedData", ".gradle", "bin", "obj",
}

# Files that reveal project metadata
METADATA_FILES = [
    "package.json", "Cargo.toml", "go.mod", "pyproject.toml",
    "setup.py", "setup.cfg", "pom.xml", "build.gradle",
    "Gemfile", "composer.json", "mix.exs", "Makefile",
    "docker-compose.yml", "docker-compose.yaml",
    "README.md", "README.rst", "README.txt", "README",
]

# ── Entry point detection patterns ─────────────────────────────────────────

# Handler-shape patterns: code that looks like an HTTP route or handler
# registration. They produce no entry point. A match that no `entry` or `mount`
# record of the graph registers (same file, same line) is reported as
# unrecognised, for the model to read.
HANDLER_SHAPE_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("Express/Koa route", re.compile(
        r"""(?:app|router|server)\s*\.\s*(?:get|post|put|patch|delete|all|use)\s*\(\s*['"](/[^'"]*?)['"]""",
        re.IGNORECASE,
    )),
    ("Decorator route (Flask/FastAPI/NestJS)", re.compile(
        r"""@(?:app\.)?(?:route|get|post|put|patch|delete|api_view|RequestMapping|GetMapping|PostMapping)\s*\(\s*['"](/[^'"]*?)['"]""",
        re.IGNORECASE,
    )),
    ("Next.js/Remix route handler", re.compile(
        r"""export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b""",
    )),
    ("Go route registration", re.compile(
        r"""\.\s*(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|Any)\s*\(\s*"/""",
    )),
    ("GraphQL resolver", re.compile(
        r"""@(?:Query|Mutation|Subscription|Resolver)\s*\(""",
    )),
    ("gRPC service", re.compile(
        r"""^service\s+(\w+)\s*\{""", re.MULTILINE,
    )),
]

# Entry point patterns that still produce entry points (`source: "pattern"`).
ENTRY_POINT_PATTERNS: list[tuple[str, str, re.Pattern[str]]] = [
    # CLI
    ("cli", "CLI command", re.compile(
        r"""\.command\s*\(\s*['"]([\w\-:]+)['"]""",
    )),
    ("cli", "argparse subparser", re.compile(
        r"""add_parser\s*\(\s*['"]([\w\-]+)['"]""",
    )),
    # Event handlers
    ("event", "Event listener", re.compile(
        r"""\.on\s*\(\s*['"]([\w\-:.]+)['"]""",
    )),
    ("event", "Event subscriber decorator", re.compile(
        r"""@(?:EventHandler|Subscribe|Listener|on_event)\s*\(\s*['"]([\w\-:.]+)['"]""",
    )),
    # Cron / scheduled
    ("cron", "Cron schedule", re.compile(
        r"""@?(?:Cron|Schedule|Scheduled|crontab)\s*\(\s*['"]([^'"]+)['"]""",
        re.IGNORECASE,
    )),
    # Exported handlers (generic)
    ("manual", "Exported handler", re.compile(
        r"""export\s+(?:async\s+)?function\s+(handle\w+|process\w+|on\w+)\b""",
    )),
]

# A match on a comment line is a commented-out registration, not a hit.
COMMENT_PREFIXES = ("//", "#", "*")

KNOWLEDGE_GRAPH_FILE = "knowledge-graph.jsonl"
KNOWLEDGE_GRAPH_FORMAT = "excavator-knowledge-graph-lines/1"

# Skip test files and the extraction script itself. Each shape is anchored to a
# path segment, so latest_routes.py is not a test file
# (split-domain-areas.mjs uses the same shapes).
TEST_FILE_PATTERN = re.compile(
    r"(?:\.test\.|\.spec\.|__tests__/|_test\.go$|_test\.py$|(?:^|/)test_\w+\.py$|(?:^|/)extract-domain-context\.py$)"
)


# ── Gitignore support ──────────────────────────────────────────────────────

def parse_gitignore(project_root: Path) -> list[re.Pattern[str]]:
    """Parse .gitignore into a list of compiled regex patterns."""
    gitignore = project_root / ".gitignore"
    patterns: list[re.Pattern[str]] = []
    if not gitignore.exists():
        return patterns

    for line in gitignore.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        # Convert glob to regex (simplified)
        regex = line.replace(".", r"\.").replace("**/", "(.*/)?").replace("*", "[^/]*").replace("?", "[^/]")
        if line.endswith("/"):
            regex = regex.rstrip("/") + "(/|$)"
        try:
            patterns.append(re.compile(regex))
        except re.error as e:
            print(f"Warning: skipping invalid gitignore pattern '{line}': {e}", file=sys.stderr)
    return patterns


def is_ignored(rel_path: str, gitignore_patterns: list[re.Pattern[str]]) -> bool:
    """Check if a relative path matches any gitignore pattern."""
    for pattern in gitignore_patterns:
        if pattern.search(rel_path):
            return True
    return False


# ── File tree scanner ──────────────────────────────────────────────────────

def scan_file_tree(
    root: Path,
    gitignore_patterns: list[re.Pattern[str]],
    truncated: dict[str, int],
    max_depth: int = MAX_FILE_TREE_DEPTH,
) -> list[str]:
    """Return a flat list of relative file paths (source files only).

    Source files beyond MAX_FILES_TOTAL, and directories below
    MAX_FILE_TREE_DEPTH, are counted under truncated["fileTree"] and
    truncated["depthSkippedDirs"]."""
    result: list[str] = []

    def _walk(dir_path: Path, depth: int) -> None:
        if depth > max_depth:
            truncated["depthSkippedDirs"] += 1
            return
        try:
            entries = sorted(dir_path.iterdir(), key=lambda e: (not e.is_dir(), e.name.lower()))
        except PermissionError:
            return

        for entry in entries:
            # Skip symlinks to avoid infinite loops
            if entry.is_symlink():
                continue
            rel = str(entry.relative_to(root))
            if entry.is_dir():
                if entry.name in SKIP_DIRS:
                    continue
                if is_ignored(rel + "/", gitignore_patterns):
                    continue
                _walk(entry, depth + 1)
            elif entry.is_file():
                if entry.suffix not in SOURCE_EXTENSIONS:
                    continue
                if is_ignored(rel, gitignore_patterns):
                    continue
                if len(result) >= MAX_FILES_TOTAL:
                    truncated["fileTree"] += 1
                    continue
                result.append(rel)

    _walk(root, 0)
    return result


# ── Entry points from the facts ────────────────────────────────────────────

class GraphUnavailable(Exception):
    """The knowledge graph cannot give entry points; the message says why."""


def read_entry_point_records(graph_path: Path) -> list[dict[str, Any]]:
    """Stream the graph's line file and return its `entryPoint` records.

    Raises GraphUnavailable when the file is missing, cannot be read, does not
    start with a header of the expected format, has a line that is not JSON,
    has no `entryPoints` stream (a graph built before the stream existed), or
    holds a different number of records than its header counts."""
    if not graph_path.is_file():
        raise GraphUnavailable(f"{graph_path} not found")
    records: list[dict[str, Any]] = []
    header: dict[str, Any] | None = None
    try:
        with graph_path.open("r", encoding="utf-8") as handle:
            for number, raw in enumerate(handle, start=1):
                text = raw.strip()
                if not text:
                    continue
                try:
                    record = json.loads(text)
                except json.JSONDecodeError as error:
                    raise GraphUnavailable(f"line {number} is not JSON ({error.msg})")
                if not isinstance(record, dict):
                    raise GraphUnavailable(f"line {number} is not a record")
                if header is None:
                    if record.get("record") != "header" or record.get("format") != KNOWLEDGE_GRAPH_FORMAT:
                        raise GraphUnavailable("the first line is not a knowledge graph header")
                    header = record
                    continue
                if record.get("record") == "entryPoint" and isinstance(record.get("entryPoint"), dict):
                    records.append(record["entryPoint"])
    except OSError as error:
        raise GraphUnavailable(f"cannot read {graph_path} ({error.strerror})")
    if header is None:
        raise GraphUnavailable("the graph file is empty")
    keys = header.get("keys")
    counts = header.get("counts")
    if not isinstance(keys, list) or "entryPoints" not in keys or not isinstance(counts, dict):
        raise GraphUnavailable("the graph has no entryPoints stream; run /excavator again to rebuild it")
    if counts.get("entryPoints") != len(records):
        raise GraphUnavailable("the header's entryPoints count does not match the records")
    return records


def snippet_at(root: Path, rel_path: str, line_no: int, cache: dict[str, list[str]]) -> str:
    """Five lines from `line_no` of a file, cut to MAX_PREVIEW_CHARS."""
    if rel_path not in cache:
        try:
            cache[rel_path] = (root / rel_path).read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError:
            cache[rel_path] = []
    lines = cache[rel_path]
    start = max(0, line_no - 1)
    return "\n".join(lines[start:start + 5])[:MAX_PREVIEW_CHARS]


def script_entry_points(
    root: Path, records: list[dict[str, Any]], counts: dict[str, int]
) -> tuple[list[dict[str, Any]], set[tuple[str, int]]]:
    """Entry points from `kind: "entry"` records, and the registration sites
    (file, line) of every `entry` and `mount` record.

    An entry point belongs to its handler's file when the handler resolves to a
    node or a module, else to the registration file. Records on test files are
    dropped and counted under counts["scriptOnTestFiles"]."""
    registered: set[tuple[str, int]] = set()
    entry_points: list[dict[str, Any]] = []
    cache: dict[str, list[str]] = {}
    for record in records:
        kind = record.get("kind")
        reg_file = record.get("file")
        reg_line = record.get("line")
        if kind not in ("entry", "mount") or not isinstance(reg_file, str) or not isinstance(reg_line, int):
            continue
        registered.add((reg_file, reg_line))
        if kind != "entry":
            continue
        handler = record.get("handler") if isinstance(record.get("handler"), dict) else {}
        handler_file = handler.get("file")
        file = handler_file if handler.get("fate") in ("node", "module") and isinstance(handler_file, str) else reg_file
        if TEST_FILE_PATTERN.search(file) or TEST_FILE_PATTERN.search(reg_file):
            counts["scriptOnTestFiles"] += 1
            continue
        line = handler.get("line") if file == handler_file and isinstance(handler.get("line"), int) else reg_line
        entry: dict[str, Any] = {
            "file": file,
            "line": line,
            "type": record.get("routeKind"),
            "description": f"{record.get('framework')} route",
            "source": "script",
            "method": record.get("method"),
            "bucket": record.get("bucket"),
            "registeredAt": {"file": reg_file, "line": reg_line},
            "snippet": snippet_at(root, reg_file, reg_line, cache),
        }
        if record.get("path") is not None:
            entry["path"] = record["path"]
        else:
            entry["pathText"] = record.get("pathText")
        entry["match"] = f"{entry['method']} {record.get('path') if record.get('path') is not None else record.get('pathText')}"[:120]
        entry_points.append(entry)
    counts["script"] = len(entry_points)
    return entry_points, registered


def find_unrecognised_files(
    root: Path, file_paths: list[str], registered: set[tuple[str, int]]
) -> list[dict[str, Any]]:
    """Files with code shaped like a route or handler registration that no
    `entry` or `mount` record registers at that file and line."""
    found: list[dict[str, Any]] = []
    for rel_path in file_paths:
        if TEST_FILE_PATTERN.search(rel_path):
            continue
        try:
            content = (root / rel_path).read_text(encoding="utf-8", errors="replace")
        except (OSError, UnicodeDecodeError):
            continue
        lines = content.splitlines()
        hits: set[tuple[int, str]] = set()
        for description, pattern in HANDLER_SHAPE_PATTERNS:
            for match in pattern.finditer(content):
                line_no = content[:match.start()].count("\n") + 1
                if line_no <= len(lines) and lines[line_no - 1].lstrip().startswith(COMMENT_PREFIXES):
                    continue
                if (rel_path, line_no) not in registered:
                    hits.add((line_no, description))
        if hits:
            ordered = sorted(hits)
            found.append({
                "file": rel_path,
                "lines": [line for line, _ in ordered],
                "matches": [description for _, description in ordered],
            })
    found.sort(key=lambda item: item["file"])
    return found


# ── Entry point detection (patterns) ───────────────────────────────────────

def detect_entry_points(
    root: Path, file_paths: list[str], truncated: dict[str, int]
) -> list[dict[str, Any]]:
    """Scan source files for the CLI, event, cron and exported-handler patterns.

    Matches beyond MAX_ENTRY_POINTS are counted under truncated["entryPoints"].
    The cap applies to these pattern entry points only."""
    entry_points: list[dict[str, Any]] = []

    for rel_path in file_paths:
        if TEST_FILE_PATTERN.search(rel_path):
            continue
        full_path = root / rel_path
        try:
            content = full_path.read_text(encoding="utf-8", errors="replace")
        except (OSError, UnicodeDecodeError):
            continue

        lines = content.splitlines()
        for entry_type, description, pattern in ENTRY_POINT_PATTERNS:
            for match in pattern.finditer(content):
                if len(entry_points) >= MAX_ENTRY_POINTS:
                    truncated["entryPoints"] += 1
                    continue
                # Find line number
                line_no = content[:match.start()].count("\n") + 1
                # Extract a snippet (signature + a few lines)
                start = max(0, line_no - 1)
                end = min(len(lines), start + 5)
                snippet = "\n".join(lines[start:end])

                entry_points.append({
                    "file": rel_path,
                    "line": line_no,
                    "type": entry_type,
                    "description": description,
                    "source": "pattern",
                    "match": match.group(0)[:120],
                    "snippet": snippet[:300],
                })

    return entry_points


# ── File signatures ────────────────────────────────────────────────────────

def extract_file_signatures(root: Path, file_paths: list[str]) -> list[dict[str, Any]]:
    """Extract exports and imports from every file (lightweight).

    Every file gets a signature: the split step decides what each analyzer
    sees, so ranking files here would only hide the low-ranked ones."""
    signatures: list[dict[str, Any]] = []

    for rel_path in file_paths:
        full_path = root / rel_path
        try:
            content = full_path.read_text(encoding="utf-8", errors="replace")
        except (OSError, UnicodeDecodeError):
            continue

        lines = content.splitlines()[:MAX_LINES_PER_FILE]
        truncated = "\n".join(lines)

        # Extract exports (JS/TS)
        exports = re.findall(
            r"export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\s+(\w+)",
            truncated,
        )
        # Extract exports (Python)
        if not exports:
            exports = re.findall(r"^(?:def|class)\s+(\w+)", truncated, re.MULTILINE)

        # Extract imports (first 20)
        imports = re.findall(
            r"""(?:import\s+.*?from\s+['"]([^'"]+)['"]|from\s+([\w.]+)\s+import)""",
            truncated,
        )
        import_list = [m[0] or m[1] for m in imports][:20]

        signatures.append({
            "file": rel_path,
            "exports": exports[:20],
            "imports": import_list,
            "lines": len(content.splitlines()),
            "preview": truncated[:MAX_PREVIEW_CHARS],
        })

    return signatures


# ── Metadata extraction ────────────────────────────────────────────────────

def extract_metadata(root: Path) -> dict[str, Any]:
    """Read project metadata files."""
    metadata: dict[str, Any] = {}

    for filename in METADATA_FILES:
        filepath = root / filename
        if not filepath.exists():
            continue
        try:
            content = filepath.read_text(encoding="utf-8", errors="replace")
        except (OSError, UnicodeDecodeError):
            continue

        if filename == "package.json":
            try:
                pkg = json.loads(content)
                metadata["package.json"] = {
                    "name": pkg.get("name"),
                    "description": pkg.get("description"),
                    "scripts": list((pkg.get("scripts") or {}).keys()),
                    "dependencies": list((pkg.get("dependencies") or {}).keys()),
                    "devDependencies": list((pkg.get("devDependencies") or {}).keys()),
                }
            except json.JSONDecodeError:
                metadata["package.json"] = content[:500]
        elif filename.endswith((".md", ".rst", ".txt")) or filename == "README":
            metadata[filename] = content[:2000]
        elif filename.endswith((".toml", ".cfg", ".mod")):
            metadata[filename] = content[:1000]
        elif filename.endswith((".json", ".yml", ".yaml", ".xml", ".gradle")):
            metadata[filename] = content[:1000]

    return metadata


# ── Main ───────────────────────────────────────────────────────────────────

def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: python extract-domain-context.py <project-root>", file=sys.stderr)
        sys.exit(1)

    project_root = Path(sys.argv[1]).resolve()
    if not project_root.is_dir():
        print(f"Error: {project_root} is not a directory", file=sys.stderr)
        sys.exit(1)

    try:
        # Ensure output directory exists
        output_dir = resolve_data_dir(project_root) / "intermediate"
        output_dir.mkdir(parents=True, exist_ok=True)
        output_path = output_dir / "domain-context.json"

        print(f"Scanning {project_root} ...", file=sys.stderr)

        truncated = {"fileTree": 0, "entryPoints": 0, "depthSkippedDirs": 0}
        gitignore_patterns = parse_gitignore(project_root)
        file_tree = scan_file_tree(project_root, gitignore_patterns, truncated)
        print(f"  Found {len(file_tree)} source files", file=sys.stderr)

        counts = {"script": 0, "pattern": 0, "scriptOnTestFiles": 0, "unrecognisedFiles": 0}
        pattern_entries = detect_entry_points(project_root, file_tree, truncated)
        counts["pattern"] = len(pattern_entries)
        script_entries: list[dict[str, Any]] = []
        unrecognised: list[dict[str, Any]] = []
        try:
            records = read_entry_point_records(resolve_data_dir(project_root) / KNOWLEDGE_GRAPH_FILE)
            script_entries, registered = script_entry_points(project_root, records, counts)
            unrecognised = find_unrecognised_files(project_root, file_tree, registered)
            counts["unrecognisedFiles"] = len(unrecognised)
            entry_point_source = "facts"
        except GraphUnavailable as error:
            entry_point_source = "unavailable"
            print(
                f"Warning: HTTP and UI entry points are unavailable, the facts could not be read: {error}",
                file=sys.stderr,
            )
        entry_points = script_entries + pattern_entries
        print(
            f"  Detected {len(entry_points)} entry points "
            f"(script={counts['script']} pattern={counts['pattern']} "
            f"unrecognisedFiles={counts['unrecognisedFiles']} source={entry_point_source})",
            file=sys.stderr,
        )

        signatures = extract_file_signatures(project_root, file_tree)
        print(f"  Extracted {len(signatures)} file signatures", file=sys.stderr)

        metadata = extract_metadata(project_root)
        print(f"  Read {len(metadata)} metadata files", file=sys.stderr)

        context = {
            "projectRoot": str(project_root),
            "fileCount": len(file_tree),
            "fileTree": file_tree,
            "entryPoints": entry_points,
            "entryPointSource": entry_point_source,
            "unrecognisedFiles": unrecognised,
            "counts": counts,
            "fileSignatures": signatures,
            "metadata": metadata,
            "truncated": truncated,
        }

        output = json.dumps(context, indent=2)
        output_path.write_text(output, encoding="utf-8")
        size_kb = len(output.encode()) / 1024
        print(f"  Wrote {output_path} ({size_kb:.0f} KB)", file=sys.stderr)

    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
