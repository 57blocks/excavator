import { useLinks } from '../lib/links';
import { systemName, useText } from '../lib/text';
import type { PageData } from '../lib/types';
import { Crumbs } from './Crumbs';
import { Cell, TableScroll } from './Tables';
import { PageTitle, useBlockTitle } from '../lib/outline';

/** A role: for each verified feature whose entry names it, what the entry says the role can do. It is what the entries say, not a list of permissions. */
export function RolePage({ data, label }: { data: PageData; label: string }) {
  const t = useText();
  const nav = useLinks();
  const matrixTitle = useBlockTitle('roles-matrix', t('md.matrix.roleFeature.heading'));
  const cells = data.entities.roleFeature.cells.filter((cell) => cell.role === label);
  const featureText = (id: string) => t('md.summary.feature', { id, name: data.features.find((feature) => feature.id === id)?.name ?? '' });
  return (
    <article className="page" data-view="role" data-role={label}>
      <Crumbs trail={[<a href={nav.rolesMatrix}>{matrixTitle}</a>, label]} />
      <header className="page-head">
        <h1 className="page-title">{label}</h1>
      </header>
      <p className="muted summary-note">{t('md.entities.roles.note')}</p>
      <section className="section" aria-labelledby="role-features">
        <h2 className="section-title" id="role-features">{t('md.entities.roles.heading')}</h2>
        {cells.length === 0 ? <p className="muted">{t('md.none')}</p> : (
          <ul className="plain-list">
            {cells.map((cell) => <li key={cell.feature}><a href={nav.feature(cell.feature)}>{t('md.entities.role.item', { feature: featureText(cell.feature), can: cell.can.join(' ') })}</a></li>)}
          </ul>
        )}
      </section>
    </article>
  );
}

/** Roles by feature: a cell holds what the verified entry of the feature says the role can do; an empty cell means the entry says nothing about the role. */
export function RolesMatrixPage({ data }: { data: PageData }) {
  const t = useText();
  const nav = useLinks();
  const { roles, features, cells } = data.entities.roleFeature;
  const heading = t('md.matrix.roleFeature.heading');
  const featureText = (id: string) => t('md.summary.feature', { id, name: data.features.find((feature) => feature.id === id)?.name ?? '' });
  return (
    <article className="page" data-view="roles-matrix">
      <header className="page-head">
        <p className="eyebrow">{systemName(data.project, t)}</p>
        <PageTitle fallback={heading} />
      </header>
      <p className="muted summary-note">{t('md.matrix.roleFeature.note')}</p>
      {roles.length === 0 || features.length === 0 ? <p className="muted">{t('md.none')}</p> : (
        <TableScroll label={heading} wide>
          <thead>
            <tr>
              <th scope="col">{t('md.table.role')}</th>
              {features.map((id) => <th scope="col" key={id}><a href={nav.feature(id)}>{featureText(id)}</a></th>)}
            </tr>
          </thead>
          <tbody>
            {roles.map((role) => (
              <tr key={role}>
                <Cell row><a href={nav.role(role)}>{role}</a></Cell>
                {features.map((id) => {
                  const can = cells.find((cell) => cell.role === role && cell.feature === id)?.can;
                  return <Cell key={id}>{can === undefined ? undefined : can.join(' ')}</Cell>;
                })}
              </tr>
            ))}
          </tbody>
        </TableScroll>
      )}
    </article>
  );
}
