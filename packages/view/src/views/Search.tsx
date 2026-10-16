// Search (artifact-view task 5.2): subsequence matching over node names,
// paths and ids, plus exact identifier-term matching over the source index.
// Both run in the data Worker; the identifier term index is rebuilt there on
// the first identifier search (never on the ready path), with progress shown
// meanwhile. The query lives in the hash (#/search?q=...).
import { useEffect, useMemo, useState } from 'react';
import { cellText, isTable, type ViewData } from '../data';
import { fmtNumber } from '../format';
import type { IdentifierSearchResult, PostingsState } from '../model/engine';
import type { NameSearchResult } from '../model/search';
import { indexLiteralsStatus } from '../model/overview';
import { mainThreadQueries, type QueryService } from '../decode/queries';
import { nodeHash, sectionHash } from '../routes';
import { clearBusy, markBusy, report } from '../instrument';

export const RESULT_LIMIT = 100;
const DEBOUNCE_MS = 150;

// The term index outlives the view (it lives in the Worker), so its state does too.
let postingsState: PostingsState | null = null;
let fallbackQueries: { data: ViewData; service: QueryService } | null = null;

function serviceFor(data: ViewData): QueryService {
  if (data.queries) return data.queries;
  if (fallbackQueries?.data !== data) fallbackQueries = { data, service: mainThreadQueries(data.segments) };
  return fallbackQueries.service;
}

type Identifiers =
  | { state: 'idle' }
  | { state: 'building'; done: number; total: number }
  | { state: 'done'; result: IdentifierSearchResult }
  | { state: 'error'; message: string };

export function Search({ data, query }: { data: ViewData; query: string }) {
  const [text, setText] = useState(query);
  const [debounced, setDebounced] = useState(query);
  const [names, setNames] = useState<NameSearchResult | null>(null);
  const [identifiers, setIdentifiers] = useState<Identifiers>({ state: 'idle' });
  const [nameError, setNameError] = useState<string | null>(null);
  const hasIndex = isTable(data.segments['index.chunks']) && isTable(data.segments['index.tokens']);
  postingsState ??= hasIndex ? 'idle' : 'unavailable';
  const [postings, setPostings] = useState<PostingsState>(postingsState);
  const literals = indexLiteralsStatus(data.meta);

  // A hash change from outside (back button, a link) replaces the input.
  useEffect(() => {
    setText(query);
    setDebounced(query);
  }, [query]);

  useEffect(() => {
    if (text === debounced) return;
    const handle = setTimeout(() => setDebounced(text), DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [text, debounced]);

  useEffect(() => {
    const q = debounced.trim();
    setNames(null);
    setNameError(null);
    setIdentifiers({ state: 'idle' });
    if (q === '') return;
    let live = true;
    const service = serviceFor(data);
    const key = `search:${q}`;
    markBusy(key);
    const namesDone = service.run({ op: 'names', text: q, limit: RESULT_LIMIT }).then(
      (result) => live && setNames(result as NameSearchResult),
      (error: unknown) => live && setNameError(error instanceof Error ? error.message : String(error)),
    );
    let identifiersDone: Promise<unknown> = Promise.resolve();
    if (hasIndex) {
      if (postingsState !== 'ready') {
        postingsState = 'building';
        setPostings('building');
      }
      identifiersDone = service
        .run({ op: 'identifiers', text: q, limit: RESULT_LIMIT }, (done, total) => {
          if (live) setIdentifiers({ state: 'building', done, total });
        })
        .then(
          (result) => {
            postingsState = 'ready';
            if (!live) return;
            setPostings('ready');
            setIdentifiers({ state: 'done', result: result as IdentifierSearchResult });
          },
          (error: unknown) => {
            postingsState = 'idle';
            if (!live) return;
            setPostings('idle');
            setIdentifiers({ state: 'error', message: error instanceof Error ? error.message : String(error) });
          },
        );
    }
    Promise.all([namesDone, identifiersDone]).finally(() => clearBusy(key));
    return () => {
      live = false;
      clearBusy(key);
    };
  }, [debounced, data, hasIndex]);

  const identifierTotal = identifiers.state === 'done' && identifiers.result.available ? identifiers.result.total : null;
  useEffect(() => {
    report('data-postings', postings);
    report('data-search-query', debounced.trim() === '' ? null : debounced.trim());
    report('data-search-results', names ? names.total : null);
    report('data-search-identifier-results', identifierTotal);
  }, [postings, debounced, names, identifierTotal]);
  useEffect(
    () => () => {
      for (const name of ['data-postings', 'data-search-query', 'data-search-results', 'data-search-identifier-results']) report(name, null);
    },
    [],
  );

  const onInput = (value: string) => {
    setText(value);
    // Keep the query in the hash without a history entry per keystroke.
    window.history.replaceState(null, '', sectionHash('search', { q: value.trim() === '' ? null : value }));
  };

  return (
    <div className="content" data-section="search" data-postings={postings}>
      <section className="card">
        <h2>Search</h2>
        <input
          className="search-input"
          type="search"
          value={text}
          placeholder="Name, path, id, or an identifier such as formatGreeting"
          aria-label="Search nodes"
          autoFocus
          onChange={(event) => onInput(event.target.value)}
        />
        <p className="muted">
          Names, paths and ids match as subsequences (letters in order). Identifiers match whole source-index terms, split the
          way the index splits them.
        </p>
      </section>
      {debounced.trim() !== '' && (
        <div className="grid-2">
          <NameResults data={data} result={names} error={nameError} />
          <IdentifierResults data={data} hasIndex={hasIndex} identifiers={identifiers} literals={literals} />
        </div>
      )}
    </div>
  );
}

function NodeItem({ data, row, extra }: { data: ViewData; row: number; extra?: string }) {
  const nodes = data.segments.nodes;
  const str = (column: string) => (isTable(nodes) ? cellText(data.strings, nodes.columns[column]?.[row] ?? -1) : undefined);
  const line0 = isTable(nodes) ? (nodes.columns.line0?.[row] ?? -1) : -1;
  const id = str('id') ?? '';
  return (
    <li className="result" data-result={id}>
      <a href={nodeHash(id)}>
        <strong>{str('name') ?? id}</strong>
      </a>{' '}
      <span className="muted">{str('type') ?? '—'}</span>
      {extra && <span className="muted"> · matched {extra}</span>}
      <div className="mono muted result-path">
        {str('path') ?? '—'}
        {line0 >= 0 ? `:${line0}` : ''}
      </div>
    </li>
  );
}

function NameResults({ data, result, error }: { data: ViewData; result: NameSearchResult | null; error: string | null }) {
  return (
    <section className="card" data-results="names" data-total={result ? result.total : undefined}>
      <h2>Names, paths and ids</h2>
      {error && <p className="bad-text">Search failed: {error}</p>}
      {!error && !result && <p className="muted">Searching…</p>}
      {result && (
        <>
          <p className="secondary">
            {fmtNumber(result.total)} {result.total === 1 ? 'node matches' : 'nodes match'}
            {result.total > result.hits.length && `; showing the best ${fmtNumber(result.hits.length)}`}.
          </p>
          <ul className="results">
            {result.hits.map((hit) => (
              <NodeItem key={hit.row} data={data} row={hit.row} extra={hit.field} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function IdentifierResults({
  data, hasIndex, identifiers, literals,
}: { data: ViewData; hasIndex: boolean; identifiers: Identifiers; literals: { state: string; label: string } }) {
  const scopeNote = useMemo(() => {
    if (literals.state === 'embedded') return null;
    return `Identifiers only: comment and string-literal terms are not in this page (${literals.label}).`;
  }, [literals]);
  if (!hasIndex) {
    return (
      <section className="card" data-results="identifiers" data-identifier-search="unavailable">
        <h2>Identifiers</h2>
        <p className="secondary">Identifier search not available: this page was baked without a source index (source-index.jsonl was missing).</p>
      </section>
    );
  }
  return (
    <section
      className="card"
      data-results="identifiers"
      data-identifier-search="available"
      data-identifier-scope={literals.state === 'embedded' ? 'identifiers+literals' : 'identifiers'}
      data-total={identifiers.state === 'done' && identifiers.result.available ? identifiers.result.total : undefined}
    >
      <h2>Identifiers</h2>
      {scopeNote && <p className="muted" data-scope-note="identifiers-only">{scopeNote}</p>}
      {identifiers.state === 'idle' && <p className="muted">Waiting for the identifier index…</p>}
      {identifiers.state === 'building' && (
        <div data-postings-progress={identifiers.total > 0 ? Math.round((identifiers.done / identifiers.total) * 100) : 0}>
          <p className="muted">
            Building the identifier index (first identifier search only): {fmtNumber(identifiers.done)} of {fmtNumber(identifiers.total)} chunks.
          </p>
          <div className="funnel-bar">
            <span style={{ width: `${identifiers.total > 0 ? (identifiers.done / identifiers.total) * 100 : 0}%` }} />
          </div>
        </div>
      )}
      {identifiers.state === 'error' && <p className="bad-text">Identifier search failed: {identifiers.message}</p>}
      {identifiers.state === 'done' && !identifiers.result.available && (
        <p className="secondary">Identifier search not available: this page carries no source index.</p>
      )}
      {identifiers.state === 'done' && identifiers.result.available && <IdentifierHits data={data} result={identifiers.result} />}
    </section>
  );
}

function IdentifierHits({ data, result }: { data: ViewData; result: Extract<IdentifierSearchResult, { available: true }> }) {
  if (result.terms.length === 0) return <p className="muted">The query has no identifier terms (letters or digits).</p>;
  return (
    <>
      <p className="secondary">
        Terms: <span className="mono">{result.terms.join(' ')}</span>.{' '}
        {result.missingTerms.length > 0
          ? `No source-index chunk has ${result.missingTerms.length === 1 ? 'the term' : 'the terms'} ${result.missingTerms.join(', ')}.`
          : `${fmtNumber(result.total)} ${result.total === 1 ? 'node has' : 'nodes have'} every term${result.total > result.rows.length ? `; showing the first ${fmtNumber(result.rows.length)}` : ''}.`}
        {result.buildMs > 0 && <span className="muted"> Index built in {fmtNumber(Math.round(result.buildMs))} ms.</span>}
      </p>
      {result.chunksOutsideGraph > 0 && (
        <p className="muted">{fmtNumber(result.chunksOutsideGraph)} matching index chunks belong to nodes that are not in this graph.</p>
      )}
      <ul className="results">
        {result.rows.map((row) => (
          <NodeItem key={row} data={data} row={row} />
        ))}
      </ul>
    </>
  );
}
