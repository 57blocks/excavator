#!/usr/bin/env python3
"""doc-map.py -- read a folder of functional documents into text (openspec: changes/doc-map-read).

Usage:
  doc-map.py read <docsDir> <projectRoot>
  doc-map.py units <unitsFile> <projectRoot>

`read` walks <docsDir> (never into `.git` or `.excavator`, never through a
symbolic link) and gives every file one status:
  read          converted to text that has a non-blank character
  empty         converted, but the text is blank (a scanned PDF, an empty file)
  no-converter  the format needs an external tool this machine does not have
  unsupported   the extension is not a supported format, or the entry is a symbolic link
  failed        the conversion failed (a broken archive, a wrong encoding, a tool error)
The statuses add up to the number of files. The format comes from the extension:
  .md .markdown .txt .rst .adoc   UTF-8 text as it is (a leading BOM dropped)
  .html .htm .xhtml               the declared charset (UTF-8 when none); script and
                                  style left out, block elements on their own lines
  .docx                           the paragraphs of word/document.xml, one per line
  .odt                            the paragraphs and headings of content.xml, one per line
  .pdf                            pdftotext; pages separated by form feeds
  .doc                            textutil, else antiword
Each text goes to <projectRoot>/.excavator/doc-map/text/<path>.txt; the whole
text directory is replaced on every run. The product is
<projectRoot>/.excavator/doc-map.json (`excavator-doc-map/1`).

`units` reads the units a model listed from those texts,
`{ "units": [ { "document", "id", "title", "quote" } ] }`, and checks each:
the document was read, the quote is in its text, the id (when not null) is in
its text, and no id or quote repeats within a document. Quote and text are
compared after one fixed normalization (NFKC; soft hyphens and zero-width
characters dropped; curly quotes, dashes and the ellipsis folded to ASCII;
every run of white space made one space); case is kept. If any unit fails,
every failure is printed and the product is left as it was; otherwise the
units go into the product, each with the line (and, in a PDF, the page) of
its quote's first occurrence and the number of occurrences.
"""

import codecs
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unicodedata
import zipfile
from html.parser import HTMLParser
from xml.etree import ElementTree

FORMAT = "excavator-doc-map/1"
PRODUCT = "doc-map.json"
WORK_DIR = "doc-map"
TEXT_DIR = "text"
SKIPPED_DIRS = {".git", ".excavator"}
TOOL_TIMEOUT_SECONDS = 300

FORMATS = {
    **dict.fromkeys([".md", ".markdown", ".txt", ".rst", ".adoc"], "text"),
    **dict.fromkeys([".html", ".htm", ".xhtml"], "html"),
    ".docx": "docx",
    ".odt": "odt",
    ".pdf": "pdf",
    ".doc": "doc",
}

RESIDUAL_ASSUMPTIONS = [
    "Which passages are units is the model's judgement: the script checks only that each quote and id is in "
    "the document's text, not that the passage describes a function, nor that the title matches it.",
    "Text comes from the file's own text: images, scanned pages and embedded objects are not read, so a "
    "scanned PDF is empty.",
    "A .docx is read from its main body only: headers, footers, footnotes, comments and deleted revisions are left out.",
    "HTML text leaves out script and style content and image alt text, but keeps text that a style would hide.",
    "Numbers a format generates rather than stores (Word and OpenDocument list and heading numbering, HTML "
    "ordered-list numbers) are not in the text, so a unit numbered that way has no id.",
    ".doc text is what textutil or antiword gives; textutil keeps Word field instructions (such as HYPERLINK, "
    "PAGEREF or a citation manager's records) in the text.",
    "PDF text is in pdftotext's reading order; text set in several columns may interleave.",
    "The format of a file is decided by its extension.",
]


class ConversionError(Exception):
    """The file is of a supported format but could not be converted."""


class MissingConverter(Exception):
    """The format needs an external tool this machine does not have."""


def _decode_utf8(data):
    if data.startswith(codecs.BOM_UTF8):
        data = data[len(codecs.BOM_UTF8):]
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError as error:
        raise ConversionError(f"not UTF-8 text: {error.reason} at byte {error.start}") from None


def _plain_text(path):
    with open(path, "rb") as handle:
        return _decode_utf8(handle.read())


_CHARSET = re.compile(rb"""<meta[^>]+charset\s*=\s*["']?\s*([A-Za-z0-9_.:-]+)|<\?xml[^>]+encoding\s*=\s*["']([A-Za-z0-9_.:-]+)""", re.I)


class _HtmlText(HTMLParser):
    BLOCKS = {
        "address", "article", "aside", "blockquote", "br", "caption", "dd", "div", "dl", "dt", "figcaption",
        "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li", "main", "nav",
        "ol", "p", "pre", "section", "table", "tr", "ul", "title",
    }
    CELLS = {"td", "th"}
    HIDDEN = {"script", "style"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.hidden = 0
        self.pre = 0

    def handle_starttag(self, tag, attrs):
        if tag in self.HIDDEN:
            self.hidden += 1
        elif tag in self.BLOCKS:
            self.parts.append("\n")
        elif tag in self.CELLS:
            self.parts.append("\t")
        if tag == "pre":
            self.pre += 1

    def handle_endtag(self, tag):
        if tag in self.HIDDEN:
            self.hidden = max(0, self.hidden - 1)
        elif tag in self.BLOCKS:
            self.parts.append("\n")
        if tag == "pre":
            self.pre = max(0, self.pre - 1)

    def handle_data(self, data):
        if self.hidden:
            return
        self.parts.append(data if self.pre else re.sub(r"\s+", " ", data))


def _html_text(path):
    with open(path, "rb") as handle:
        data = handle.read()
    declared = _CHARSET.search(data[:4096])
    if data.startswith(codecs.BOM_UTF8) or declared is None:
        text = _decode_utf8(data)
    else:
        charset = (declared.group(1) or declared.group(2)).decode("ascii")
        try:
            codecs.lookup(charset)
        except LookupError:
            raise ConversionError(f"unknown charset {charset}") from None
        try:
            text = data.decode(charset)
        except UnicodeDecodeError as error:
            raise ConversionError(f"not {charset} text: {error.reason} at byte {error.start}") from None
    parser = _HtmlText()
    parser.feed(text)
    parser.close()
    lines = (line.strip(" \t") for line in "".join(parser.parts).split("\n"))
    return "\n".join(line for line in lines if line)


def _zip_member(path, member):
    try:
        with zipfile.ZipFile(path) as archive:
            return ElementTree.fromstring(archive.read(member))
    except (zipfile.BadZipFile, KeyError, ElementTree.ParseError, OSError) as error:
        raise ConversionError(f"cannot read {member}: {error}") from None


W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
MC_FALLBACK = "{http://schemas.openxmlformats.org/markup-compatibility/2006}Fallback"


def _docx_paragraph(element, parts):
    """The text of one paragraph; a paragraph nested in it (a text box) is a line of its own."""
    for child in element:
        tag = child.tag
        if tag == W + "p":
            continue
        if tag == W + "t":
            parts.append(child.text or "")
        elif tag == W + "tab":
            parts.append("\t")
        elif tag in (W + "br", W + "cr"):
            parts.append("\n")
        elif tag == W + "noBreakHyphen":
            parts.append("-")
        else:
            _docx_paragraph(child, parts)


def _docx_text(path):
    root = _zip_member(path, "word/document.xml")
    fallbacks = {id(p) for fallback in root.iter(MC_FALLBACK) for p in fallback.iter(W + "p")}
    lines = []
    for paragraph in root.iter(W + "p"):
        if id(paragraph) in fallbacks:
            continue
        parts = []
        _docx_paragraph(paragraph, parts)
        lines.append("".join(parts))
    return "\n".join(lines)


T = "{urn:oasis:names:tc:opendocument:xmlns:text:1.0}"


def _odt_paragraph(element, parts):
    """Mixed content of one paragraph; a paragraph nested in it (a note, a frame) is a line of its own."""
    parts.append(element.text or "")
    for child in element:
        tag = child.tag
        if tag in (T + "p", T + "h"):
            pass
        elif tag == T + "s":
            parts.append(" " * int(child.get(T + "c", "1")))
        elif tag == T + "tab":
            parts.append("\t")
        elif tag == T + "line-break":
            parts.append("\n")
        else:
            _odt_paragraph(child, parts)
        parts.append(child.tail or "")


def _odt_text(path):
    root = _zip_member(path, "content.xml")
    lines = []
    for paragraph in root.iter():
        if paragraph.tag in (T + "p", T + "h"):
            parts = []
            _odt_paragraph(paragraph, parts)
            lines.append("".join(parts))
    return "\n".join(lines)


def _run_tool(command):
    try:
        done = subprocess.run(command, capture_output=True, timeout=TOOL_TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired:
        raise ConversionError(f"{os.path.basename(command[0])} timed out after {TOOL_TIMEOUT_SECONDS} s") from None
    except OSError as error:
        raise ConversionError(f"{os.path.basename(command[0])} could not run: {error}") from None
    if done.returncode != 0:
        message = done.stderr.decode("utf-8", "replace").strip().splitlines()
        raise ConversionError(f"{os.path.basename(command[0])} exited {done.returncode}: {message[0] if message else ''}")
    return _decode_utf8(done.stdout)


def find_converters():
    """The external tools for PDF and .doc, by name, or None."""
    doc = next((tool for tool in ("textutil", "antiword") if shutil.which(tool)), None)
    return {"pdf": "pdftotext" if shutil.which("pdftotext") else None, "doc": doc}


def _pdf_text(path, converters):
    if converters["pdf"] is None:
        raise MissingConverter("pdftotext (poppler-utils) is not installed")
    text = _run_tool([shutil.which("pdftotext"), "-enc", "UTF-8", path, "-"])
    return text[:-1] if text.endswith("\f") else text


def _doc_text(path, converters):
    tool = converters["doc"]
    if tool is None:
        raise MissingConverter("neither textutil nor antiword is installed")
    if tool == "textutil":
        return _run_tool([shutil.which("textutil"), "-convert", "txt", "-stdout", path])
    return _run_tool([shutil.which("antiword"), "-m", "UTF-8.txt", path])


def convert(path, kind, converters):
    if kind == "text":
        text = _plain_text(path)
    elif kind == "html":
        text = _html_text(path)
    elif kind == "docx":
        text = _docx_text(path)
    elif kind == "odt":
        text = _odt_text(path)
    elif kind == "pdf":
        text = _pdf_text(path, converters)
    else:
        text = _doc_text(path, converters)
    return text.replace("\r\n", "\n").replace("\r", "\n")


def _sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def list_entries(docs_root):
    """Every file and symbolic link below docs_root, as POSIX paths relative to it, sorted."""
    entries = []
    for directory, dirs, files in os.walk(docs_root, followlinks=False):
        relative = os.path.relpath(directory, docs_root)
        prefix = "" if relative == "." else relative.replace(os.sep, "/") + "/"
        kept = []
        for name in dirs:
            if os.path.islink(os.path.join(directory, name)):
                entries.append(prefix + name)
            elif name not in SKIPPED_DIRS:
                kept.append(name)
        dirs[:] = kept
        entries.extend(prefix + name for name in files)
    return sorted(entries)


def document_row(docs_root, path, converters, text_root):
    full = os.path.join(docs_root, *path.split("/"))
    row = {
        "path": path, "format": None, "bytes": None, "sha256": None, "status": None, "reason": None,
        "text": None, "chars": None, "lines": None, "pages": None, "units": None,
    }
    if os.path.islink(full):
        row.update(status="unsupported", reason="symbolic link")
        return row
    if not os.path.isfile(full):
        row.update(status="unsupported", reason="not a regular file")
        return row
    row.update(bytes=os.path.getsize(full), sha256=_sha256(full))
    extension = os.path.splitext(path)[1].lower()
    kind = FORMATS.get(extension)
    if kind is None:
        row.update(status="unsupported", reason=f"extension {extension or '(none)'}")
        return row
    row["format"] = kind
    try:
        text = convert(full, kind, converters)
    except MissingConverter as error:
        row.update(status="no-converter", reason=str(error))
        return row
    except ConversionError as error:
        row.update(status="failed", reason=str(error))
        return row
    if not text.strip():
        row.update(status="empty", reason="no text layer; the pages may be images" if kind == "pdf" else "no text")
        return row
    target = os.path.join(text_root, *path.split("/")) + ".txt"
    os.makedirs(os.path.dirname(target), exist_ok=True)
    with open(target, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)
    row.update(
        status="read", text=f"{WORK_DIR}/{TEXT_DIR}/{path}.txt", chars=len(text), lines=text.count("\n") + 1,
        pages=text.count("\f") + 1 if kind == "pdf" else None,
    )
    return row


STATUSES = ("read", "empty", "no-converter", "unsupported", "failed")
COUNT_KEYS = {"read": "read", "empty": "empty", "no-converter": "noConverter", "unsupported": "unsupported", "failed": "failed"}


def write_json(path, value):
    directory = os.path.dirname(path)
    handle = tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=directory, prefix=".doc-map-", suffix=".json", delete=False)
    try:
        with handle:
            json.dump(value, handle, ensure_ascii=False, indent=1)
            handle.write("\n")
        os.replace(handle.name, path)
    except BaseException:
        os.unlink(handle.name)
        raise


def replace_dir(new, old):
    """Put directory `new` in place of `old`, then remove what `old` held."""
    retired = None
    if os.path.lexists(old):
        retired = tempfile.mkdtemp(prefix=".retired-", dir=os.path.dirname(old))
        os.rename(old, os.path.join(retired, "text"))
    os.rename(new, old)
    if retired is not None:
        shutil.rmtree(retired)


def read_command(docs_dir, project_root):
    docs_root = os.path.abspath(docs_dir)
    if not os.path.isdir(docs_root):
        raise SystemExit(f"doc-map: not a directory: {docs_dir}")
    if not os.path.isdir(project_root):
        raise SystemExit(f"doc-map: not a directory: {project_root}")
    data_dir = os.path.join(os.path.abspath(project_root), ".excavator")
    work_dir = os.path.join(data_dir, WORK_DIR)
    os.makedirs(work_dir, exist_ok=True)
    converters = find_converters()
    staging = tempfile.mkdtemp(prefix=".text-", dir=work_dir)
    try:
        rows = [document_row(docs_root, path, converters, staging) for path in list_entries(docs_root)]
        counts = {"files": len(rows), **{key: 0 for key in COUNT_KEYS.values()}, "units": None}
        for row in rows:
            counts[COUNT_KEYS[row["status"]]] += 1
        if sum(counts[key] for key in COUNT_KEYS.values()) != counts["files"]:
            raise AssertionError("statuses do not add up to the files")
        replace_dir(staging, os.path.join(work_dir, TEXT_DIR))
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise
    product = {
        "format": FORMAT,
        "docsRoot": docs_root,
        "converters": converters,
        "counts": counts,
        "residualAssumptions": RESIDUAL_ASSUMPTIONS,
        "documents": rows,
        "units": None,
    }
    write_json(os.path.join(data_dir, PRODUCT), product)
    print(
        f"doc-map: {counts['files']} files: {counts['read']} read, {counts['empty']} empty, "
        f"{counts['noConverter']} no-converter, {counts['unsupported']} unsupported, {counts['failed']} failed"
    )


UNIT_KEYS = ("document", "id", "title", "quote")
INVISIBLE = {"\u00ad", "\u200b", "\u200c", "\u200d", "\u2060", "\ufeff"}
FOLDS = {
    **dict.fromkeys("\u2018\u2019\u201a\u201b\u2032", "'"),
    **dict.fromkeys("\u201c\u201d\u201e\u201f\u2033", '"'),
    **dict.fromkeys("\u2010\u2011\u2012\u2013\u2014\u2015\u2212", "-"),
    "\u2026": "...",
}


def normalize(text):
    """The text as compared, and for each of its characters the index in `text` it came from.

    NFKC is applied to each base character together with the combining marks
    after it, so a decomposed accent compares equal to a precomposed one.
    """
    out, starts = [], []
    blank_at = None
    i, end = 0, len(text)
    while i < end:
        j = i + 1
        while j < end and unicodedata.combining(text[j]):
            j += 1
        for char in unicodedata.normalize("NFKC", text[i:j]):
            if char in INVISIBLE:
                continue
            folded = FOLDS.get(char, char)
            if folded.isspace():
                if blank_at is None:
                    blank_at = i
                continue
            if blank_at is not None:
                if out:
                    out.append(" ")
                    starts.append(blank_at)
                blank_at = None
            for piece in folded:
                out.append(piece)
                starts.append(i)
        i = j
    return "".join(out), starts


def _has_token(haystack, needle):
    """Whether `needle` occurs in `haystack` with no letter or digit right before or after it."""
    at = haystack.find(needle)
    while at != -1:
        after = at + len(needle)
        if (at == 0 or not haystack[at - 1].isalnum()) and (after == len(haystack) or not haystack[after].isalnum()):
            return True
        at = haystack.find(needle, at + 1)
    return False


def _short(text, limit=80):
    return json.dumps(text if len(text) <= limit else text[:limit] + "...", ensure_ascii=False)


def _load_text(data_dir, row):
    text_root = os.path.realpath(os.path.join(data_dir, WORK_DIR, TEXT_DIR))
    path = os.path.realpath(os.path.join(data_dir, row["text"]))
    if not path.startswith(text_root + os.sep):
        raise ValueError(f"its text path {row['text']} is outside {WORK_DIR}/{TEXT_DIR}")
    try:
        with open(path, encoding="utf-8", newline="") as handle:
            text = handle.read()
    except OSError as error:
        raise ValueError(f"its text cannot be read ({error.strerror}); run read again") from None
    if len(text) != row["chars"]:
        raise ValueError("its text changed after read; run read again")
    return text, *normalize(text)


def check_units(listing, rows, data_dir):
    """The recorded units, or the list of problems with the listing."""
    problems, units, texts, seen = [], [], {}, {}
    for at, unit in enumerate(listing):
        where = f"units[{at}]"
        if not isinstance(unit, dict):
            problems.append(f"{where}: not an object")
            continue
        unknown = sorted(set(unit) - set(UNIT_KEYS))
        missing = [key for key in UNIT_KEYS if key not in unit]
        if unknown:
            problems.append(f"{where}: unknown keys {', '.join(unknown)}")
        if missing:
            problems.append(f"{where}: missing keys {', '.join(missing)}")
        document, unit_id, title, quote = (unit.get(key) for key in UNIT_KEYS)
        if not (isinstance(title, str) and title.strip()):
            problems.append(f"{where}: title must be a non-empty string")
        if unit_id is not None and not (isinstance(unit_id, str) and unit_id.strip()):
            problems.append(f"{where}: id must be a non-empty string or null")
            unit_id = None
        quote_key = normalize(quote)[0] if isinstance(quote, str) else ""
        if not quote_key:
            problems.append(f"{where}: quote must be a non-empty string")
        row = rows.get(document) if isinstance(document, str) else None
        if row is None:
            problems.append(f"{where}: document {_short(str(document))} is not in the product")
            continue
        if row["status"] != "read":
            problems.append(f"{where}: document {_short(document)} is {row['status']}, not read")
            continue
        if document not in texts:
            try:
                texts[document] = _load_text(data_dir, row)
            except ValueError as error:
                texts[document] = error
        if isinstance(texts[document], ValueError):
            problems.append(f"{where}: document {_short(document)}: {texts[document]}")
            continue
        text, compared, starts = texts[document]
        if unit_id is not None:
            id_key = normalize(unit_id)[0]
            if not _has_token(compared, id_key):
                problems.append(f"{where}: id {_short(unit_id)} is not in {_short(document)}")
            elif (document, "id", id_key) in seen:
                problems.append(f"{where}: id {_short(unit_id)} repeats units[{seen[(document, 'id', id_key)]}]")
            else:
                seen[(document, "id", id_key)] = at
        if not quote_key:
            continue
        found = compared.find(quote_key)
        if found == -1:
            problems.append(f"{where}: quote not in {_short(document)}: {_short(quote)}")
            continue
        if (document, "quote", quote_key) in seen:
            problems.append(f"{where}: quote repeats units[{seen[(document, 'quote', quote_key)]}]")
            continue
        seen[(document, "quote", quote_key)] = at
        origin = starts[found]
        units.append({
            "document": document, "id": unit_id, "title": title, "quote": quote,
            "line": text.count("\n", 0, origin) + 1,
            "page": text.count("\f", 0, origin) + 1 if row["format"] == "pdf" else None,
            "occurrences": compared.count(quote_key),
        })
    return units, problems


def units_command(units_file, project_root):
    data_dir = os.path.join(os.path.abspath(project_root), ".excavator")
    product_path = os.path.join(data_dir, PRODUCT)
    try:
        with open(product_path, encoding="utf-8") as handle:
            product = json.load(handle)
    except (OSError, ValueError) as error:
        raise SystemExit(f"doc-map: no readable product at {product_path} ({error}); run read first") from None
    if not isinstance(product, dict) or product.get("format") != FORMAT:
        raise SystemExit(f"doc-map: {product_path} is not an {FORMAT} product; run read again")
    try:
        with open(units_file, encoding="utf-8") as handle:
            listing = json.load(handle)
    except (OSError, ValueError) as error:
        raise SystemExit(f"doc-map: the units file is not readable JSON: {error}") from None
    if not isinstance(listing, dict) or set(listing) != {"units"} or not isinstance(listing["units"], list):
        raise SystemExit('doc-map: the units file must be an object with one key, "units", holding an array')
    rows = {row["path"]: row for row in product["documents"]}
    units, problems = check_units(listing["units"], rows, data_dir)
    if problems:
        print(f"doc-map: {len(problems)} problems in {units_file}; nothing was recorded:", file=sys.stderr)
        for problem in problems:
            print(f"  {problem}", file=sys.stderr)
        raise SystemExit(1)
    per_document = {}
    for unit in units:
        per_document[unit["document"]] = per_document.get(unit["document"], 0) + 1
    for row in product["documents"]:
        row["units"] = per_document.get(row["path"], 0) if row["status"] == "read" else None
    product["counts"]["units"] = len(units)
    product["units"] = units
    write_json(product_path, product)
    without = sum(1 for row in product["documents"] if row["units"] == 0)
    print(f"doc-map: {len(units)} units from {len(per_document)} documents; {without} read documents have none")


USAGE = "usage: doc-map.py read <docsDir> <projectRoot> | doc-map.py units <unitsFile> <projectRoot>"


def main(argv):
    if len(argv) == 3 and argv[0] == "read":
        read_command(argv[1], argv[2])
        return 0
    if len(argv) == 3 and argv[0] == "units":
        units_command(argv[1], argv[2])
        return 0
    print(USAGE, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
