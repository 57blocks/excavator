import type { SelectionEntry, ViewData } from '../data';
import { Badge } from '../components/Badge';
import { StackedBars } from '../components/StackedBars';
import { fmtNumber, text } from '../format';
import { languageColors, languageOrder } from '../model/colors';
import { conservationText, coverageRows, excludedEntries, groupGaps, selectionFunnel } from '../model/coverage';
import { sectionHash } from '../routes';

export function Coverage({ data, scope }: { data: ViewData; scope: string | null }) {
  const selection = data.meta.selection ?? data.coverage?.selection ?? null;
  const colors = languageColors(languageOrder(data.coverage));
  const { rows, skipReasons } = coverageRows(data.coverage);
  const unbalanced = rows.filter((r) => !r.balanced);
  return (
    <div className="content" data-section="coverage">
      <Funnel selection={selection} />
      <section className="card" aria-labelledby="languages-cov-heading">
        <h2 id="languages-cov-heading">Files per language</h2>
        {data.coverage === null ? (
          <p className="bad-text">The graph has no coverage record.</p>
        ) : rows.length === 0 ? (
          <p className="muted">The coverage record lists no languages.</p>
        ) : (
          <>
            <StackedBars rows={rows} skipReasons={skipReasons} colors={colors} />
            <h3>Conservation: files = parsed + zero symbols + skipped</h3>
            <p data-conservation={unbalanced.length === 0 ? 'ok' : 'fail'} className={unbalanced.length === 0 ? 'ok-text' : 'bad-text'}>
              {unbalanced.length === 0
                ? `Every language balances (${rows.length} languages).`
                : `${unbalanced.length} of ${rows.length} languages do not balance: ${unbalanced.map((r) => r.language).join(', ')}.`}
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Language</th>
                    <th className="num">Files</th>
                    <th className="num">Parsed</th>
                    <th className="num">Zero symbols</th>
                    <th>Skipped</th>
                    <th>Equation</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.language} data-language={row.language} data-balanced={row.balanced ? 'true' : 'false'}>
                      <td>
                        <span className="swatch" style={{ background: colors.get(row.language), marginRight: 8 }} />
                        {row.language}
                      </td>
                      <td className="num">{fmtNumber(row.files)}</td>
                      <td className="num">{fmtNumber(row.parsed)}</td>
                      <td className="num">{fmtNumber(row.zeroSymbol)}</td>
                      <td className="secondary">{row.skipped.length === 0 ? '—' : row.skipped.map((s) => `${s.reason} ${fmtNumber(s.count)}`).join(', ')}</td>
                      <td className={`equation ${row.balanced ? 'ok-text' : 'bad-text'}`}>{conservationText(row)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
      <Gaps data={data} scope={scope} />
      <ExcludedEntries entries={excludedEntries(selection)} />
    </div>
  );
}

function Funnel({ selection }: { selection: ViewData['meta']['selection'] }) {
  const funnel = selectionFunnel(selection);
  const max = Math.max(1, funnel.candidates ?? 0, ...funnel.branches.map((b) => b.value ?? 0));
  return (
    <section className="card" aria-labelledby="funnel-heading" data-section="funnel">
      <h2 id="funnel-heading">Source selection</h2>
      {!funnel.recorded ? (
        <p className="muted">The manifest records no selection funnel.</p>
      ) : (
        <>
          <div className="funnel-row" data-funnel="candidates">
            <span>Candidates</span>
            <span className="funnel-bar">
              <span style={{ width: `${((funnel.candidates ?? 0) / max) * 100}%` }} />
            </span>
            <span className="num mono">{fmtNumber(funnel.candidates)}</span>
          </div>
          {funnel.branches.map((b) => (
            <div className={`funnel-row${b.key === 'selected' ? '' : ' branch'}`} key={b.key} data-funnel={b.key}>
              <span className="secondary">→ {b.label}</span>
              <span className="funnel-bar">
                <span style={{ width: `${((b.value ?? 0) / max) * 100}%` }} />
              </span>
              <span className="num mono">{fmtNumber(b.value)}</span>
            </div>
          ))}
          {funnel.policyVersion && <p className="muted mono">policy {funnel.policyVersion}</p>}
        </>
      )}
    </section>
  );
}

function Gaps({ data, scope }: { data: ViewData; scope: string | null }) {
  const { scopes, groups } = groupGaps(data.gaps, scope);
  return (
    <section className="card" aria-labelledby="gaps-heading" data-section="gaps">
      <h2 id="gaps-heading">Gaps ({fmtNumber(data.gaps.length)} records)</h2>
      <div className="toolbar">
        <label>
          Scope{' '}
          <select
            value={scope ?? ''}
            onChange={(event) => {
              window.location.hash = sectionHash('coverage', { scope: event.target.value || null });
            }}
          >
            <option value="">All scopes</option>
            {scopes.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        {scope !== null && !scopes.includes(scope) && <span className="bad-text">No gap has scope {scope}.</span>}
      </div>
      {data.gaps.length === 0 ? (
        <p className="muted">The graph records no gaps.</p>
      ) : (
        groups.map((group) => (
          <div key={group.kind} data-gap-kind={group.kind}>
            <h3>
              <span className="mono">{group.kind}</span> <span className="muted">· {group.records.length} records · total count {fmtNumber(group.total)}</span>
            </h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Scope</th>
                    <th className="num">Count</th>
                    <th>Reason</th>
                    <th>Samples</th>
                  </tr>
                </thead>
                <tbody>
                  {group.records.map((gap, i) => (
                    <tr key={i}>
                      <td className="mono">{text(gap.scope)}</td>
                      <td className="num">{fmtNumber(gap.count)}</td>
                      <td>{text(gap.reason)}</td>
                      <td>
                        {Array.isArray(gap.samples) && gap.samples.length > 0 ? (
                          <ul className="samples">
                            {gap.samples.map((s, j) => (
                              <li key={j}>{text(s)}</li>
                            ))}
                          </ul>
                        ) : (
                          <span className="muted">none</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
    </section>
  );
}

const ENTRY_LIMIT = 500;

function ExcludedEntries({ entries }: { entries: SelectionEntry[] }) {
  const shown = entries.slice(0, ENTRY_LIMIT);
  return (
    <section className="card" aria-labelledby="excluded-heading" data-section="excluded">
      <h2 id="excluded-heading">Files not selected ({fmtNumber(entries.length)})</h2>
      {entries.length === 0 ? (
        <p className="muted">Every candidate file was selected.</p>
      ) : (
        <>
          {entries.length > shown.length && (
            <p className="secondary">
              Showing the first {fmtNumber(shown.length)} of {fmtNumber(entries.length)} entries.
            </p>
          )}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Path</th>
                  <th>Kind</th>
                  <th>Reason</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((e, i) => (
                  <tr key={i}>
                    <td className="mono">{text(e.path)}</td>
                    <td>
                      <Badge state="missing">{text(e.kind)}</Badge>
                    </td>
                    <td>{text(e.reason)}</td>
                    <td className="secondary">{text(e.detail)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
