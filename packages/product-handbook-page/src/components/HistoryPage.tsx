import { useLinks } from '../lib/links';
import { useText } from '../lib/text';
import type { Text } from '../lib/text';
import type { History, PageData, Technical } from '../lib/types';
import { Cell, TableScroll } from './Tables';
import { PageTitle } from '../lib/outline';

/** The key of the fixed text of a reason (`not-a-repository` is `notARepository`). */
const reasonText = (t: Text, reason: string): string => t(`md.history.reason.${reason.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())}`);

/** The commits of each year as a table and as bars drawn from it; a year without commits has a zero and no application. */
function Years({ history }: { history: History }) {
  const t = useText();
  const top = Math.max(1, ...history.years.map((row) => row.commits));
  return (
    <section className="section" aria-labelledby="hist-years" data-part="history-years">
      <h2 className="section-title" id="hist-years">{t('md.history.yearsHeading')}</h2>
      <p className="muted summary-note">{t('md.history.yearsNote')}</p>
      {history.years.length === 0 ? <p className="muted">{t('md.none')}</p> : (
        <>
          <TableScroll label={t('md.history.yearsHeading')} wide>
            <thead>
              <tr><th scope="col">{t('md.history.table.year')}</th><th scope="col">{t('md.table.commits')}</th><th scope="col">{t('md.history.table.byApplication')}</th></tr>
            </thead>
            <tbody>
              {history.years.map((row) => (
                <tr key={row.year} data-year={row.year}>
                  <Cell row>{String(row.year)}</Cell>
                  <Cell>{String(row.commits)}</Cell>
                  <td data-empty={Object.keys(row.byApp).length === 0 ? 'true' : undefined}>
                    {Object.keys(row.byApp).length > 0 && (
                      <ul className="rule-list">
                        {Object.entries(row.byApp).map(([application, count]) => <li key={application}>{t('md.history.byAppItem', { application, count })}</li>)}
                      </ul>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableScroll>
          <p className="muted summary-note">{t('md.history.chartNote')}</p>
          <div className="year-bars" role="img" aria-label={t('md.history.chartTitle')} data-part="history-chart">
            {history.years.map((row) => (
              <div className="year-bar" key={row.year}>
                <span>{row.year}</span>
                <span className="year-bar-track"><span className="year-bar-fill" style={{ width: `${(row.commits * 100) / top}%` }} /></span>
                <span className="year-bar-count">{row.commits}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function Applications({ history }: { history: History }) {
  const t = useText();
  return (
    <section className="section" aria-labelledby="hist-apps" data-part="history-apps">
      <h2 className="section-title" id="hist-apps">{t('md.history.appsHeading')}</h2>
      <p className="muted summary-note">{t('md.history.appsNote')}</p>
      {history.apps.length === 0 ? <p className="muted">{t('md.none')}</p> : (
        <TableScroll label={t('md.history.appsHeading')} wide>
          <thead>
            <tr>
              <th scope="col">{t('md.table.directory')}</th><th scope="col">{t('md.table.firstCommit')}</th><th scope="col">{t('md.table.lastCommit')}</th>
              <th scope="col">{t('md.table.commits')}</th><th scope="col">{t('md.table.authors')}</th><th scope="col">{t('md.history.table.authorsEighty')}</th>
            </tr>
          </thead>
          <tbody>
            {history.apps.map((row) => (
              <tr key={row.dir} data-application={row.dir}>
                <Cell row>{row.dir}</Cell>
                {row.commits === null ? (
                  <>
                    <Cell>{t('md.history.appNoHistory', { reason: reasonText(t, row.reason ?? 'no-commits') })}</Cell>
                    <Cell /><Cell /><Cell /><Cell />
                  </>
                ) : (
                  <>
                    <Cell>{row.first ?? undefined}</Cell><Cell>{row.last ?? undefined}</Cell>
                    <Cell>{String(row.commits)}</Cell><Cell>{String(row.authors)}</Cell><Cell>{String(row.authors80)}</Cell>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </TableScroll>
      )}
    </section>
  );
}

/** The files that change most: the name in the product view, the path in the technical view; each feature links to its page. */
function Hotspots({ data, technical }: { data: PageData; technical: Technical | undefined }) {
  const t = useText();
  const nav = useLinks();
  const { history } = data;
  const name = (id: string): string => data.features.find((feature) => feature.id === id)?.name ?? id;
  return (
    <section className="section" aria-labelledby="hist-hotspots" data-part="history-hotspots">
      <h2 className="section-title" id="hist-hotspots">{t('md.history.hotspotsHeading')}</h2>
      <p className="muted summary-note">{t('md.history.hotspotsNote')}</p>
      {history.hotspots.some((row) => row.uncertain > 0) && <p className="muted summary-note">{t('md.history.uncertainNote')}</p>}
      {history.hotspots.length === 0 ? <p className="muted">{t('md.none')}</p> : (
        <TableScroll label={t('md.history.hotspotsHeading')} wide>
          <thead>
            <tr>
              <th scope="col">{t(technical === undefined ? 'md.history.table.file' : 'md.history.table.path')}</th><th scope="col">{t('md.table.application')}</th><th scope="col">{t('md.table.commits')}</th>
              <th scope="col">{t('md.table.authors')}</th><th scope="col">{t('md.table.lines')}</th><th scope="col">{t('md.history.table.lastChange')}</th><th scope="col">{t('md.table.features')}</th>
            </tr>
          </thead>
          <tbody>
            {history.hotspots.map((row, index) => (
              <tr key={index}>
                <Cell row>{technical?.history.hotspots[index] ?? row.name}</Cell>
                <Cell>{row.app ?? undefined}</Cell>
                <Cell>{row.uncertain > 0 ? t('md.history.commitsUncertain', { commits: row.commits, uncertain: row.uncertain }) : String(row.commits)}</Cell><Cell>{String(row.authors)}</Cell><Cell>{String(row.lines)}</Cell><Cell>{row.last}</Cell>
                <td data-empty={row.features.length === 0 ? 'true' : undefined}>
                  {row.features.map((id, at) => <span key={id}>{at > 0 && ', '}<a href={nav.feature(id)}>{name(id)}</a></span>)}
                </td>
              </tr>
            ))}
          </tbody>
        </TableScroll>
      )}
    </section>
  );
}

function CoChange({ history, technical }: { history: History; technical: Technical | undefined }) {
  const t = useText();
  const file = (path: string, application: string | null): string => t('md.history.fileInApplication', { file: path, application: application ?? '-' });
  return (
    <section className="section" aria-labelledby="hist-co" data-part="history-cochange">
      <h2 className="section-title" id="hist-co">{t('md.history.coChangeHeading')}</h2>
      <p className="muted summary-note">{t('md.history.coChangeNote')}</p>
      {history.coChange.length === 0 ? <p className="muted">{t('md.none')}</p> : (
        <TableScroll label={t('md.history.coChangeHeading')} wide>
          <thead>
            <tr><th scope="col">{t('md.history.table.firstFile')}</th><th scope="col">{t('md.history.table.secondFile')}</th><th scope="col">{t('md.history.table.together')}</th></tr>
          </thead>
          <tbody>
            {history.coChange.map((row, index) => (
              <tr key={index}>
                <Cell row>{file(technical?.history.coChange[index]?.a ?? row.a, row.appA)}</Cell>
                <Cell>{file(technical?.history.coChange[index]?.b ?? row.b, row.appB)}</Cell>
                <Cell>{String(row.commits)}</Cell>
              </tr>
            ))}
          </tbody>
        </TableScroll>
      )}
    </section>
  );
}

function Tests({ history }: { history: History }) {
  const t = useText();
  return (
    <section className="section" aria-labelledby="hist-tests" data-part="history-tests">
      <h2 className="section-title" id="hist-tests">{t('md.history.testsHeading')}</h2>
      <p className="muted summary-note">{t('md.history.testsNote', { conventions: history.conventions.map((id) => t(`md.history.test.${id}`)).join('; ') })}</p>
      {history.tests.length === 0 ? <p className="muted">{t('md.none')}</p> : (
        <TableScroll label={t('md.history.testsHeading')} wide>
          <thead>
            <tr><th scope="col">{t('md.table.directory')}</th><th scope="col">{t('md.table.files')}</th><th scope="col">{t('md.history.table.testFiles')}</th></tr>
          </thead>
          <tbody>
            {history.tests.map((row) => <tr key={row.dir}><Cell row>{row.dir}</Cell><Cell>{String(row.sourceFiles)}</Cell><Cell>{String(row.testFiles)}</Cell></tr>)}
          </tbody>
        </TableScroll>
      )}
    </section>
  );
}

/**
 * The code health page (both views): the commits of each year with a chart, the applications, the files that change most (the technical view
 * writes the path of each), the files changed together across applications and the source and test files of each application. A project with
 * no version history says so with the reason and still shows the test files; a missing or malformed file has one line. No number is judged.
 */
export function HistoryPage({ data, technical }: { data: PageData; technical: Technical | undefined }) {
  const t = useText();
  const { history } = data;
  return (
    <article className="page" data-view="history">
      <header className="page-head">
        <p className="eyebrow">{data.project}</p>
        <PageTitle fallback={t('md.history.heading')} />
      </header>
      {history.state === 'missing' && <p className="muted" data-part="history-missing">{t('md.history.notWritten')}</p>}
      {history.state === 'malformed' && <p className="muted" data-part="history-malformed">{t('md.history.malformed')}</p>}
      {history.state === 'ok' && (
        <>
          <p className="muted summary-note">{t('md.history.note')}</p>
          {history.noHistory === null ? (
            <>
              <Years history={history} />
              <Applications history={history} />
              <Hotspots data={data} technical={technical} />
              <CoChange history={history} technical={technical} />
            </>
          ) : <p className="muted" data-part="history-none">{t('md.history.noHistory', { reason: reasonText(t, history.noHistory.reason) })}</p>}
          <Tests history={history} />
        </>
      )}
    </article>
  );
}
