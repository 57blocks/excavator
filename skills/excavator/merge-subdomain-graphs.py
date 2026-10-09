#!/usr/bin/env python3
"""
merge-subdomain-graphs.py — Merge subdomain knowledge-graph files into one.

Auto-discovers *knowledge-graph*.json subdomain files in the project's data
dir (`.excavator/`), loads the existing line-oriented knowledge-graph.jsonl as
a base if present, and merges everything into knowledge-graph.jsonl.

Usage:
    python merge-subdomain-graphs.py <project-root> [file1.json file2.json ...]

If no files are specified, auto-discovers subdomain graphs. The retired
whole-document knowledge-graph.json is never read (zero compat) and is deleted
once the merged graph is written.

knowledge-graph.jsonl is one JSON record per line: a header (the graph's key
order, its non-stream fields and stream counts), then one record per node,
edge, layer, tour step and gap, plus the coverage ledger. This is the same
contract skills/excavator/knowledge-graph-store.mjs implements (openspec:
changes/knowledge-graph-line-store, design D1/D7); keep the two in step.

Output:
    .excavator/knowledge-graph.jsonl
"""

import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any


def resolve_data_dir(root: Path) -> Path:
    """The project's data directory -- single source of truth: `.excavator/`."""
    return root / ".excavator"

# Edge types that carry the domain hierarchy. Dropping one of these changes
# downstream graph traversal (unlike a routine `related` edge), so they are
# warned about loudly and re-tried on later runs via merge-report.json —
# subdomain graph files are cleaned up after assembly, so a drop would
# otherwise be permanent even once the missing endpoint's subdomain arrives.
STRUCTURAL_EDGE_TYPES = {"contains_flow", "flow_step", "cross_domain"}


KNOWLEDGE_GRAPH_FILE = "knowledge-graph.jsonl"
LEGACY_KNOWLEDGE_GRAPH_FILE = "knowledge-graph.json"
KNOWLEDGE_GRAPH_FORMAT = "excavator-knowledge-graph-lines/1"
# Top-level array key -> (record type, value key); see knowledge-graph-store.mjs.
GRAPH_STREAMS = {
    "nodes": ("node", "node"),
    "edges": ("edge", "edge"),
    "layers": ("layer", "layer"),
    "tour": ("tour", "step"),
    "gaps": ("gap", "gap"),
}
GRAPH_STREAM_BY_RECORD = {record: (key, field) for key, (record, field) in GRAPH_STREAMS.items()}


class KnowledgeGraphFormatError(Exception):
    """The knowledge-graph.jsonl file does not match the line contract."""


def _dump_line(record: dict[str, Any]) -> str:
    return json.dumps(record, ensure_ascii=False, separators=(",", ":"))


def write_knowledge_graph(path: Path, graph: dict[str, Any]) -> None:
    """Write `graph` as knowledge-graph.jsonl, one record per line, atomically."""
    keys = list(graph)
    fields: dict[str, Any] = {}
    counts: dict[str, int] = {}
    for key in keys:
        if key in GRAPH_STREAMS:
            if not isinstance(graph[key], list):
                raise TypeError(f"graph.{key} must be a list")
            counts[key] = len(graph[key])
        elif key != "coverage":
            fields[key] = graph[key]
    tmp = path.with_name(f"{path.name}.tmp")
    with tmp.open("w", encoding="utf-8") as out:
        out.write(_dump_line({"record": "header", "format": KNOWLEDGE_GRAPH_FORMAT,
                              "keys": keys, "fields": fields, "counts": counts}) + "\n")
        for key in keys:
            if key in GRAPH_STREAMS:
                record, field = GRAPH_STREAMS[key]
                for element in graph[key]:
                    out.write(_dump_line({"record": record, field: element}) + "\n")
            elif key == "coverage":
                out.write(_dump_line({"record": "coverage", "coverage": graph[key]}) + "\n")
    tmp.replace(path)


def read_knowledge_graph(path: Path) -> dict[str, Any]:
    """Read knowledge-graph.jsonl, validating header, record types and counts."""
    header: dict[str, Any] | None = None
    streams: dict[str, list[Any]] = {}
    coverage: list[Any] = []
    with path.open("r", encoding="utf-8") as src:
        for line_no, line in enumerate(src, start=1):
            line = line.rstrip("\n")
            if not line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError as e:
                raise KnowledgeGraphFormatError(f"{path}: invalid JSON (line {line_no}): {e}") from e
            if header is None:
                if not isinstance(record, dict) or record.get("record") != "header" \
                        or record.get("format") != KNOWLEDGE_GRAPH_FORMAT:
                    raise KnowledgeGraphFormatError(f"{path}: line 1 is not a {KNOWLEDGE_GRAPH_FORMAT} header")
                header = record
                streams = {k: [] for k in header["keys"] if k in GRAPH_STREAMS}
                continue
            kind = record.get("record") if isinstance(record, dict) else None
            if kind == "coverage" and "coverage" in header["keys"]:
                coverage.append(record.get("coverage"))
            elif kind in GRAPH_STREAM_BY_RECORD and GRAPH_STREAM_BY_RECORD[kind][0] in streams:
                key, field = GRAPH_STREAM_BY_RECORD[kind]
                streams[key].append(record.get(field))
            else:
                raise KnowledgeGraphFormatError(f"{path}: unexpected record {kind!r} (line {line_no})")
    if header is None:
        raise KnowledgeGraphFormatError(f"{path}: missing header record (file is empty)")
    for key, values in streams.items():
        if len(values) != header["counts"].get(key):
            raise KnowledgeGraphFormatError(f"{path}: {key} count mismatch")
    if len(coverage) != (1 if "coverage" in header["keys"] else 0):
        raise KnowledgeGraphFormatError(f"{path}: coverage record count mismatch")
    graph: dict[str, Any] = {}
    for key in header["keys"]:
        if key in streams:
            graph[key] = streams[key]
        elif key == "coverage":
            graph[key] = coverage[0]
        else:
            graph[key] = header["fields"][key]
    return graph


def _num(v: Any) -> float:
    """Coerce a value to float for safe comparison (handles string weights)."""
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def load_graph(path: Path) -> dict[str, Any] | None:
    """Load and minimally validate a knowledge graph JSON file."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        print(f"  Skipping {path.name}: {e}", file=sys.stderr)
        return None

    # Must have at minimum nodes and edges arrays
    if not isinstance(data.get("nodes"), list) or not isinstance(data.get("edges"), list):
        print(f"  Skipping {path.name}: missing nodes or edges array", file=sys.stderr)
        return None

    return data


def merge_graphs(graphs: list[dict[str, Any]]) -> tuple[dict[str, Any], list[str], list[dict[str, Any]]]:
    """Merge multiple knowledge graph dicts into one.

    Returns (merged, report_lines, dropped_edges) — dropped_edges holds the
    full edge dicts that were removed for missing endpoints, each with an
    extra "missing" key naming which endpoint(s) were absent.
    """

    # ── Pattern counters for "Fixed" report ──────────────────────────
    node_dedup_by_type: Counter[str] = Counter()

    # ── Detail lists for "Could not fix" report ──────────────────────
    unfixable: list[str] = []

    total_input_nodes = sum(len(g.get("nodes", [])) for g in graphs)
    total_input_edges = sum(len(g.get("edges", [])) for g in graphs)

    # ── Nodes: deduplicate by id, later occurrence wins ───────────────
    nodes_by_id: dict[str, dict] = {}
    for g in graphs:
        for node in g.get("nodes", []):
            nid = node.get("id")
            if not nid:
                unfixable.append(f"Node with no 'id' (name={node.get('name', '?')}, type={node.get('type', '?')})")
                continue
            if nid in nodes_by_id:
                node_type = node.get("type", "?")
                node_dedup_by_type[node_type] += 1
            nodes_by_id[nid] = node

    # ── Edges: deduplicate by (source, target, type), higher weight wins
    edge_dedup_count = 0
    edges_by_key: dict[tuple[str, str, str], dict] = {}
    for g in graphs:
        for edge in g.get("edges", []):
            key = (edge.get("source", ""), edge.get("target", ""), edge.get("type", ""))
            existing = edges_by_key.get(key)
            if existing is None:
                edges_by_key[key] = edge
            else:
                edge_dedup_count += 1
                if _num(edge.get("weight", 0)) > _num(existing.get("weight", 0)):
                    edges_by_key[key] = edge

    # Drop edges referencing missing nodes
    node_ids = set(nodes_by_id.keys())
    valid_edges: list[dict] = []
    dropped_edges: list[dict[str, Any]] = []
    structural_warnings: list[str] = []
    for e in edges_by_key.values():
        src, tgt = e.get("source", ""), e.get("target", "")
        if src in node_ids and tgt in node_ids:
            valid_edges.append(e)
        else:
            missing = []
            if src not in node_ids:
                missing.append(f"source '{src}'")
            if tgt not in node_ids:
                missing.append(f"target '{tgt}'")
            etype = e.get("type", "?")
            dropped_edges.append({**e, "missing": missing})
            if etype in STRUCTURAL_EDGE_TYPES:
                structural_warnings.append(
                    f"Warning: dropped structural edge {src} → {tgt} ({etype}), "
                    f"missing {', '.join(missing)} — will retry on the next merge run"
                )
            else:
                unfixable.append(f"Edge {src} → {tgt} ({etype}): dropped, missing {', '.join(missing)}")

    # ── Layers: merge by id, union nodeIds ────────────────────────────
    layers_by_id: dict[str, dict] = {}
    for g in graphs:
        for layer in g.get("layers", []):
            lid = layer.get("id", "")
            if lid in layers_by_id:
                existing_ids = set(layers_by_id[lid].get("nodeIds", []))
                existing_ids.update(layer.get("nodeIds", []))
                layers_by_id[lid]["nodeIds"] = list(existing_ids)
            else:
                layers_by_id[lid] = {**layer}

    # Drop dangling layer nodeIds
    dropped_layer_refs = 0
    for layer in layers_by_id.values():
        before = len(layer.get("nodeIds", []))
        layer["nodeIds"] = [nid for nid in layer.get("nodeIds", []) if nid in node_ids]
        diff = before - len(layer["nodeIds"])
        if diff:
            dropped_layer_refs += diff

    # ── Project metadata: merge ───────────────────────────────────────
    languages: list[str] = []
    frameworks: list[str] = []
    descriptions: list[str] = []
    latest_at = ""
    latest_hash = ""
    project_name = ""

    for g in graphs:
        proj = g.get("project", {})
        project_name = proj.get("name", "") or project_name
        for lang in proj.get("languages", []):
            if lang not in languages:
                languages.append(lang)
        for fw in proj.get("frameworks", []):
            if fw not in frameworks:
                frameworks.append(fw)
        desc = proj.get("description", "")
        if desc and desc not in descriptions:
            descriptions.append(desc)
        analyzed = proj.get("analyzedAt", "")
        if analyzed > latest_at:
            latest_at = analyzed
            latest_hash = proj.get("gitCommitHash", latest_hash)

    # ── Build report ─────────────────────────────────────────────────
    report: list[str] = []
    report.append(f"Input: {total_input_nodes} nodes, {total_input_edges} edges (from {len(graphs)} graphs)")

    # Fixed section
    fixed_lines: list[str] = []
    if node_dedup_by_type:
        for ntype, count in node_dedup_by_type.most_common():
            fixed_lines.append(f"  {count:>4} × duplicate '{ntype}' nodes removed (kept later)")
    if edge_dedup_count:
        fixed_lines.append(f"  {edge_dedup_count:>4} × duplicate edges removed (kept higher weight)")
    if dropped_layer_refs:
        fixed_lines.append(f"  {dropped_layer_refs:>4} × dangling layer nodeId refs removed")
    if fixed_lines:
        total_fixed = sum(node_dedup_by_type.values()) + edge_dedup_count + dropped_layer_refs
        report.append("")
        report.append(f"Fixed ({total_fixed} corrections):")
        report.extend(fixed_lines)

    # Structural drops surface as loud warnings, not buried counters —
    # losing hierarchy/cross-domain edges changes downstream traversal.
    if structural_warnings:
        report.append("")
        report.extend(structural_warnings)

    # Could not fix section
    if unfixable:
        report.append("")
        report.append(f"Could not fix ({len(unfixable)} issues — needs agent review):")
        for detail in unfixable:
            report.append(f"  - {detail}")

    # Output stats
    report.append("")
    report.append(f"Output: {len(nodes_by_id)} nodes, {len(valid_edges)} edges, {len(layers_by_id)} layers")

    merged: dict[str, Any] = {
        "version": "1.0.0",
        "project": {
            "name": project_name,
            "languages": languages,
            "frameworks": frameworks,
            "description": " | ".join(descriptions) if len(descriptions) > 1 else (descriptions[0] if descriptions else ""),
            "analyzedAt": latest_at,
            "gitCommitHash": latest_hash,
        },
        "nodes": list(nodes_by_id.values()),
        "edges": valid_edges,
        "layers": list(layers_by_id.values()),
        "tour": [],
    }

    return merged, report, dropped_edges


def load_pending_structural_edges(report_path: Path) -> list[dict[str, Any]]:
    """Read structural edges dropped by a previous run from merge-report.json.

    Subdomain graph files are cleaned up after assembly, so these edges only
    survive in the report — re-injecting them lets a later run resolve them
    once the missing endpoint's subdomain graph has been merged.
    """
    if not report_path.exists():
        return []
    try:
        data = json.loads(report_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        print(f"Warning: could not read {report_path.name}: {e}", file=sys.stderr)
        return []
    pending = []
    for entry in data.get("droppedEdges", []):
        if isinstance(entry, dict) and entry.get("type") in STRUCTURAL_EDGE_TYPES:
            pending.append({k: v for k, v in entry.items() if k != "missing"})
    return pending


def write_merge_report(
    report_path: Path,
    merged: dict[str, Any],
    dropped_edges: list[dict[str, Any]],
    recovered_count: int,
) -> None:
    """Persist the dropped-edge report so investigations don't require re-instrumenting the script."""
    report = {
        "generatedBy": "merge-subdomain-graphs.py",
        "output": {
            "nodes": len(merged.get("nodes", [])),
            "edges": len(merged.get("edges", [])),
            "layers": len(merged.get("layers", [])),
        },
        "recoveredStructuralEdges": recovered_count,
        "droppedEdges": dropped_edges,
    }
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: python merge-subdomain-graphs.py <project-root> [file1.json file2.json ...]", file=sys.stderr)
        sys.exit(1)

    project_root = Path(sys.argv[1]).resolve()
    data_dir = resolve_data_dir(project_root)

    if not data_dir.is_dir():
        print(f"Error: {data_dir} does not exist", file=sys.stderr)
        sys.exit(1)

    output_path = data_dir / KNOWLEDGE_GRAPH_FILE

    # Determine which files to merge
    if len(sys.argv) > 2:
        # Explicit file list
        graph_files = [Path(f).resolve() for f in sys.argv[2:]]
    else:
        # Auto-discover subdomain graphs. The glob only matches `.json`, so
        # the line-oriented main graph is never a discovery input; the
        # retired whole-document main graph is excluded explicitly.
        graph_files = sorted(
            p for p in data_dir.glob("*knowledge-graph*.json")
            if p.name != LEGACY_KNOWLEDGE_GRAPH_FILE
        )

    if not graph_files:
        print("No subdomain graphs found to merge", file=sys.stderr)
        sys.exit(0)

    print(f"Found {len(graph_files)} subdomain graphs:", file=sys.stderr)
    for f in graph_files:
        print(f"  - {f.name}", file=sys.stderr)

    # Load subdomain graphs
    graphs: list[dict[str, Any]] = []
    for f in graph_files:
        g = load_graph(f)
        if g is not None:
            graphs.append(g)
            node_count = len(g.get("nodes", []))
            edge_count = len(g.get("edges", []))
            print(f"    Loaded {f.name}: {node_count} nodes, {edge_count} edges", file=sys.stderr)

    if not graphs:
        print("Error: no valid subdomain graphs loaded", file=sys.stderr)
        sys.exit(1)

    # Load the existing main graph as base (if it exists). A base that does
    # not read back is an error: merging without it would overwrite the
    # published graph with the subdomains alone.
    if output_path.exists():
        try:
            base = read_knowledge_graph(output_path)
        except (OSError, KnowledgeGraphFormatError) as e:
            print(f"Error: cannot read base {KNOWLEDGE_GRAPH_FILE}: {e}", file=sys.stderr)
            sys.exit(1)
        node_count = len(base.get("nodes", []))
        edge_count = len(base.get("edges", []))
        print(f"    Loaded base {KNOWLEDGE_GRAPH_FILE}: {node_count} nodes, {edge_count} edges", file=sys.stderr)
        graphs.insert(0, base)  # Base first — subdomain data wins on conflict

    # Re-inject structural edges a previous run had to drop; if their missing
    # endpoints have arrived in the meantime, this run resolves them.
    report_path = data_dir / "merge-report.json"
    pending_edges = load_pending_structural_edges(report_path)
    if pending_edges:
        print(f"    Retrying {len(pending_edges)} structural edges dropped by a previous run", file=sys.stderr)
        graphs.append({"nodes": [], "edges": pending_edges})

    # Merge
    merged, report, dropped_edges = merge_graphs(graphs)

    # Print report
    print("", file=sys.stderr)
    for line in report:
        print(line, file=sys.stderr)

    # Count how many previously-dropped structural edges made it in this time
    merged_edge_keys = {(e.get("source", ""), e.get("target", ""), e.get("type", "")) for e in merged["edges"]}
    recovered = sum(
        1 for e in pending_edges
        if (e.get("source", ""), e.get("target", ""), e.get("type", "")) in merged_edge_keys
    )
    if recovered:
        print(f"Recovered {recovered} structural edges dropped by a previous run", file=sys.stderr)

    # Write output
    write_knowledge_graph(output_path, merged)
    (data_dir / LEGACY_KNOWLEDGE_GRAPH_FILE).unlink(missing_ok=True)
    write_merge_report(report_path, merged, dropped_edges, recovered)
    print(f"Merge report written to {report_path}", file=sys.stderr)

    size_kb = output_path.stat().st_size / 1024
    print(f"\nWritten to {output_path} ({size_kb:.0f} KB)", file=sys.stderr)


if __name__ == "__main__":
    main()
