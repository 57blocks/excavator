import type { ViewData } from '../data';
import { Badge } from '../components/Badge';
import { foldSlices, Ring } from '../components/Ring';
import { fmtBytes, fmtNumber, text } from '../format';
import { languageColors, languageOrder } from '../model/colors';
import {
  LANGUAGE_RING_CENTER, MEMBER_FILES_LABEL, MEMBER_SELECTED_LABEL, countRows, freshnessBanner, indexLiteralsStatus, inventoryRows,
  memberCards, semanticBadges,
} from '../model/overview';

export function Overview({ data }: { data: ViewData }) {
  const { meta } = data;
  const project = (meta.graph?.fields?.project ?? {}) as Record<string, unknown>;
  const source = meta.source ?? {};
  const banner = freshnessBanner(meta);
  const counts = countRows(meta, data.counts);
  const allMatch = counts.every((c) => c.match);
  const order = languageOrder(data.coverage);
  const colors = languageColors(order);
  const fileCounts = new Map(order.map((l) => [l, Number(data.coverage?.byLanguage?.[l]?.files) || 0]));
  const slices = foldSlices(order, fileCounts, colors);
  const isMultiRepo = typeof source.sourceRevision === 'string' && source.sourceRevision.startsWith('multi-repo:');
  const members = memberCards(meta);

  return (
    <div className="content" data-section="overview">
      <section className="banner" data-state={banner.state} data-freshness={banner.state} aria-live="polite">
        <Badge state={banner.state === 'fresh' ? 'fresh' : banner.state === 'stale' ? 'stale' : 'fail'}>
          {banner.state === 'fresh' ? 'Fresh' : banner.state === 'stale' ? 'Stale' : banner.state === 'missing' ? 'Missing' : 'Unknown'}
        </Badge>
        <div>
          <div className="title">{banner.title}</div>
          {banner.detail && <div className="secondary">{banner.detail}</div>}
          <div className="muted mono">
            data: {text(banner.manifestRevision)}
            {banner.currentRevision && banner.currentRevision !== banner.manifestRevision && <> · current: {banner.currentRevision}</>}
          </div>
          {banner.command && <div className="title" data-hint="freshness">Hint: {banner.command}</div>}
        </div>
      </section>

      <div className="grid-2">
        <section className="card" aria-labelledby="project-heading">
          <h2 id="project-heading">Project</h2>
          <dl className="facts">
            <dt>Name</dt>
            <dd data-field="project-name">{text(project.name)}</dd>
            <dt>Source revision</dt>
            <dd className="mono" data-field="source-revision">{text(source.sourceRevision)}</dd>
            <dt>Baked at</dt>
            <dd data-field="baked-at">{text(meta.bakedAt)}</dd>
            <dt>Pipeline</dt>
            <dd className="mono" data-field="pipeline-version">{text(source.pipelineVersion ?? project.pipelineVersion)}</dd>
            <dt>Analyzed at</dt>
            <dd>{text(project.analyzedAt)}</dd>
            <dt>Languages</dt>
            <dd>{Array.isArray(project.languages) ? project.languages.join(', ') || '—' : '—'}</dd>
            <dt>Bundle</dt>
            <dd className="mono">
              {text(meta.format)} · decoded in {data.decodeMode === 'worker' ? 'a worker' : 'the main thread'}
            </dd>
          </dl>
        </section>

        <section className="card" aria-labelledby="counts-heading">
          <h2 id="counts-heading">Counts</h2>
          <table data-counts-match={allMatch ? 'true' : 'false'}>
            <thead>
              <tr>
                <th>Record</th>
                <th className="num">Graph header</th>
                <th className="num">Decoded in this page</th>
                <th>Check</th>
              </tr>
            </thead>
            <tbody>
              {counts.map((row) => (
                <tr key={row.key} data-count={row.key}>
                  <td>{row.key}</td>
                  <td className="num">{fmtNumber(row.header)}</td>
                  <td className="num">{fmtNumber(row.decoded)}</td>
                  <td>{row.match ? <span className="ok-text">equal</span> : <span className="bad-text">differs</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted">The evidence row compares with the bake's streamed count; the graph header does not count evidence.</p>
        </section>
      </div>

      <div className="grid-2">
        <section className="card" aria-labelledby="languages-heading">
          <h2 id="languages-heading">Files by language</h2>
          {order.length > 0 ? (
            <Ring slices={slices} centerLabel={LANGUAGE_RING_CENTER} />
          ) : (
            <p className="muted">The graph has no coverage record, so files by language are unavailable.</p>
          )}
        </section>

        <section className="card" aria-labelledby="semantic-heading">
          <h2 id="semantic-heading">Semantic layers</h2>
          <div className="semantic-badges">
            {semanticBadges(meta, data.segments, data.counts.nodes).map((badge) => (
              <div className="semantic-badge" key={badge.artifact} data-semantic={badge.artifact} data-state={badge.state} data-summaries={badge.summaries}>
                <div className="label">{badge.label}</div>
                <Badge state={badge.state}>{badge.stateLabel}</Badge>
                <div className="muted mono">{badge.artifact}</div>
                {badge.detail && <div className="secondary">{badge.detail}</div>}
                {badge.command && <div className="mono">{badge.command}</div>}
              </div>
            ))}
          </div>
          <p className="muted">
            <a href="#/semantics">Open the semantics section</a>
          </p>
        </section>
      </div>

      {isMultiRepo && (
        <section className="card" aria-labelledby="members-heading">
          <h2 id="members-heading">Member repositories</h2>
          {members.length > 0 ? (
            <div className="members">
              {members.map((m) => (
                <div className="member" key={m.name} data-member={m.name}>
                  <div className="title">{m.name}</div>
                  <div className="muted" data-member-files={m.manifestFiles ?? ''}>
                    {fmtNumber(m.manifestFiles)} {MEMBER_FILES_LABEL}
                  </div>
                  <div className="muted" data-member-selected={m.selectedFiles ?? ''}>
                    {m.selectedFiles === null ? 'selected count not recorded' : `${fmtNumber(m.selectedFiles)} ${MEMBER_SELECTED_LABEL}`}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">This is a multi-repository target, but the bake recorded no member repositories.</p>
          )}
        </section>
      )}

      <Inventory data={data} />
    </div>
  );
}

function Inventory({ data }: { data: ViewData }) {
  const { meta } = data;
  const rows = inventoryRows(meta);
  const dropped = meta.dropped ?? [];
  const embedding = meta.source?.embedding ?? null;
  const literals = indexLiteralsStatus(meta);
  const unembedded = Object.entries(meta.unembedded ?? {}).flatMap(([kind, keys]) =>
    Object.entries(keys ?? {}).map(([key, n]) => ({ kind, key, n })),
  );
  const anomalies = Object.entries(meta.anomalies ?? {});
  return (
    <section className="card" aria-labelledby="inventory-heading" data-section="inventory">
      <h2 id="inventory-heading">Inventory</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Artifact</th>
              <th>Status</th>
              <th className="num">Size</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name} data-artifact={row.name} data-state={row.state}>
                <td className="mono">
                  {row.name}
                  {row.required && <span className="muted"> (required)</span>}
                </td>
                <td>
                  <Badge state={row.state}>
                    {row.state === 'present' ? 'Present' : row.state === 'invalid' ? 'Invalid' : row.state === 'missing' || row.state === 'missing-required' ? 'Missing' : row.state}
                  </Badge>
                </td>
                <td className="num">{fmtBytes(row.bytes)}</td>
                <td className="secondary">{row.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>Source text</h3>
      <ul data-field="embeds">
        {(meta.embeds ?? []).map((e) => (
          <li key={e.segment}>
            <span className="mono">{e.segment}</span>:{' '}
            {e.status === 'embedded' ? 'embedded' : `dropped (${e.reason === 'no-source' ? 'baked with --no-source' : e.reason === 'budget' ? 'over the source budget' : text(e.reason)})`}
          </li>
        ))}
      </ul>
      <p className="secondary" data-field="index-literals" data-state={literals.state}>
        Source index comment and string-literal text: {literals.label}
      </p>
      {dropped.length > 0 ? (
        <div data-field="dropped">
          <h3>Dropped</h3>
          <ul>
            {dropped.map((d) => (
              <li key={d.segment}>
                <span className="mono">{d.segment}</span> — {d.reason}
                {d.bytes ? ` (${fmtBytes(d.bytes)} of source text)` : ''}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="muted" data-field="dropped">Nothing was dropped.</p>
      )}
      {embedding ? (
        <p data-field="files-not-embedded" data-count={embedding.filesHashMismatch ?? 0}>
          Files not embedded because their content no longer matches the manifest:{' '}
          <strong>{fmtNumber(embedding.filesHashMismatch ?? 0)}</strong>
          {(embedding.hashMismatchSamples ?? []).length > 0 && (
            <span className="muted mono"> (e.g. {(embedding.hashMismatchSamples ?? []).join(', ')})</span>
          )}
          . Cited files embedded: {fmtNumber(embedding.filesEmbedded)} of {fmtNumber(embedding.filesCited)}; unreadable{' '}
          {fmtNumber(embedding.filesUnreadable)}; not in the manifest {fmtNumber(embedding.filesNotInManifest)}; lines out of range{' '}
          {fmtNumber(embedding.linesOutOfRange)}.
        </p>
      ) : (
        <p data-field="files-not-embedded">No source text was read for this bake.</p>
      )}
      {(unembedded.length > 0 || anomalies.length > 0) && (
        <>
          <h3>Fields not carried by the columns</h3>
          <ul>
            {unembedded.map((u) => (
              <li key={`${u.kind}.${u.key}`}>
                <span className="mono">
                  {u.kind}.{u.key}
                </span>
                : {fmtNumber(u.n)}
              </li>
            ))}
            {anomalies.map(([key, n]) => (
              <li key={key}>
                <span className="mono">{key}</span>: {fmtNumber(n)}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
