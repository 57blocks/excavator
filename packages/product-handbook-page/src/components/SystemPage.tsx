import { useLinks } from '../lib/links';
import { useText } from '../lib/text';
import type { PageData, Technical } from '../lib/types';
import { Crumbs } from './Crumbs';

/**
 * An external system of the verified overview with the two relations to
 * applications, kept apart and named for what was checked: the callers the
 * quoted code shows, and the applications whose source files hold the name
 * (the script's search, which does not say the application calls the system).
 */
export function SystemPage({ data, technical, system }: { data: PageData; technical: Technical; system: string }) {
  const t = useText();
  const nav = useLinks();
  const item = technical.integrations.find((entry) => entry.system === system);
  if (item === undefined) return null;
  const appName = (dir: string) => data.system.applications.find((application) => application.dir === dir)?.name ?? dir;
  return (
    <article className="page" data-view="system" data-system={system}>
      <Crumbs trail={[system]} />
      <header className="page-head">
        <h1 className="page-title">{system}</h1>
        <p className="lede">{t('md.entities.fact', { label: t('md.table.use'), value: item.use })}</p>
      </header>
      <p className="muted summary-note">{t('md.entities.systems.note')}</p>

      <section className="section" aria-labelledby="sys-shown">
        <h2 className="section-title" id="sys-shown">{t('md.table.callers')}</h2>
        {item.shown.length === 0 ? <p className="muted">{t('md.none')}</p> : <ul className="plain-list">{item.shown.map((dir) => <li key={dir}><a href={nav.application(dir)}>{appName(dir)}</a></li>)}</ul>}
      </section>

      <section className="section" aria-labelledby="sys-named">
        <h2 className="section-title" id="sys-named">{t('md.entities.system.named')}</h2>
        {item.named.length === 0 ? <p className="muted">{t('md.none')}</p> : (
          <ul className="plain-list">
            {item.named.map((entry) => <li key={entry.application}><a href={nav.application(entry.application)}>{t('md.entities.system.namedItem', { application: appName(entry.application), files: entry.files })}</a></li>)}
          </ul>
        )}
        <p className="muted summary-note">{t('md.entities.system.namedOutside', { count: item.namedOutside })}</p>
      </section>
    </article>
  );
}
