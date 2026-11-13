import { useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';

import { busiest, countsOf } from '../lib/handovers';
import { useLinks, useView } from '../lib/links';
import { useModel } from '../lib/model';
import { colourProps } from '../lib/strata';
import { useText } from '../lib/text';
import { plainText } from './InlineMarkdown';
import { DomainLink, Flows } from './Flows';
import { HandoverText } from './HandoverText';
import { Mark } from './Mark';

/** What is picked on the map: a domain, a hand-over line, or nothing. */
type Picked = { kind: 'domain'; id: string } | { kind: 'edge'; index: number } | null;

const SPACE_OR_ENTER = (event: KeyboardEvent): boolean => event.key === 'Enter' || event.key === ' ';

/** The default panel: the title, one line of hint and the four domains with the most hand-overs. */
function SideDefault() {
  const t = useText();
  const nav = useLinks();
  const { handovers, domains, colours } = useModel();
  const top = busiest(Object.keys(domains), handovers, 4).filter((id) => handovers.some((handover) => handover.from === id || handover.to === id));
  return (
    <>
      <h3>{t('page.map.label')}</h3>
      <p className="side-hint">{t('page.map.hint')}</p>
      <ul className="flow-list">
        {top.map((id) => {
          const counts = countsOf(handovers, id);
          return <li key={id}><b><Mark colour={colours[id]} /><a href={nav.domain(id)}>{domains[id].name}</a></b>{t('page.flow.counts', { out: counts.out, in: counts.in })}</li>;
        })}
      </ul>
    </>
  );
}

/** The panel of one domain: its name and intro, the two lists and the link to its page. */
function SideDomain({ id }: { id: string }) {
  const t = useText();
  const nav = useLinks();
  const view = useView();
  const { domains, colours } = useModel();
  const domain = domains[id];
  return (
    <>
      <h3><Mark colour={colours[id]} />{domain.name}</h3>
      <p className="side-hint">{plainText(domain.intro[view] ?? '')}</p>
      <Flows id={id} />
      <a className="side-go" href={nav.domain(id)}>{t('page.flow.open', { name: domain.name })}</a>
    </>
  );
}

/** The panel of one hand-over: the two domains and its words. */
function SideChannel({ index }: { index: number }) {
  const t = useText();
  const { handovers, colours, domains } = useModel();
  const handover = handovers[index];
  return (
    <>
      <h3><Mark colour={colours[handover.from]} />{domains[handover.from].name}</h3>
      <p className="side-hint dir-out">{t('page.handover.out')} <DomainLink id={handover.to} /></p>
      <ul className="flow-list"><li><HandoverText handover={handover} /></li></ul>
    </>
  );
}

/**
 * The atlas: the map of the domains with its side panel. A domain shows on hover (when nothing is picked), on click and on
 * Enter or Space; its hand-overs are blue lines out and ochre lines in and everything else is dimmed; a click on a line shows
 * that one hand-over; a click on the empty map clears the pick.
 */
export function Atlas() {
  const t = useText();
  const { layout, handovers, domains, colours } = useModel();
  const [picked, setPicked] = useState<Picked>(null);
  const [hover, setHover] = useState<string | null>(null);
  if (layout === null) return null;

  const domain = picked === null ? hover : picked.kind === 'domain' ? picked.id : null;
  const channel = picked?.kind === 'edge' ? picked.index : null;
  const dimmed = domain !== null || channel !== null;
  const near = new Set<string>();
  for (const edge of layout.edges) {
    if (domain !== null && edge.from === domain) near.add(edge.to);
    if (domain !== null && edge.to === domain) near.add(edge.from);
    if (channel === edge.index) { near.add(edge.from); near.add(edge.to); }
  }
  const pick = (id: string) => setPicked(picked?.kind === 'domain' && picked.id === id ? null : { kind: 'domain', id });
  const stop = (event: MouseEvent) => event.stopPropagation();

  return (
    <div className="atlas" data-part="atlas">
      <div className="atlas-map">
        <svg viewBox={`0 0 ${layout.viewBox.w} ${layout.viewBox.h}`} role="group" aria-label={t('page.map.label')} className={dimmed ? 'focus' : undefined} onClick={() => { setPicked(null); setHover(null); }}>
          <defs>
            {(['default', 'out', 'in'] as const).map((kind) => (
              <marker key={kind} id={`xv-ar-${kind}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path className={`arrow-${kind}`} d="M0,0 L10,5 L0,10 z" /></marker>
            ))}
          </defs>
          <g>
            {layout.edges.map((edge) => {
              const out = domain !== null && edge.from === domain;
              const into = domain !== null && edge.to === domain;
              const chosen = channel === edge.index;
              const kind = chosen || out ? 'out' : into ? 'in' : 'default';
              const className = ['edge', out ? 'out' : '', into ? 'in' : '', chosen ? 'picked' : ''].filter((name) => name !== '').join(' ');
              return (
                <g key={edge.index} data-edge={edge.index}>
                  <path className={className} d={edge.d} markerEnd={`url(#xv-ar-${kind})`} />
                  <path className="edge-hit" d={edge.d} onClick={(event) => { stop(event); setPicked({ kind: 'edge', index: edge.index }); }}><title>{t('page.map.edge', { from: domains[edge.from].name, to: domains[edge.to].name })}</title></path>
                </g>
              );
            })}
          </g>
          <g>
            {layout.nodes.map((node) => {
              const name = domains[node.id].name;
              const count = domains[node.id].features.length;
              const classes = ['node', node.id === layout.centre ? 'center' : '', node.id === domain ? 'on' : '', near.has(node.id) ? 'near' : ''].filter((cls) => cls !== '').join(' ');
              return (
                <g
                  key={node.id}
                  className={classes}
                  data-node={node.id}
                  {...colourProps(colours[node.id])}
                  tabIndex={0}
                  role="button"
                  aria-label={t('page.map.node', { name, count })}
                  aria-pressed={picked?.kind === 'domain' && picked.id === node.id}
                  onMouseEnter={() => { if (picked === null) setHover(node.id); }}
                  onMouseLeave={() => { if (picked === null) setHover(null); }}
                  onClick={(event) => { stop(event); pick(node.id); }}
                  onKeyDown={(event) => { if (SPACE_OR_ENTER(event)) { event.preventDefault(); pick(node.id); } }}
                >
                  {node.label !== name && <title>{name}</title>}
                  <rect x={(node.x - node.w / 2).toFixed(1)} y={(node.y - node.h / 2).toFixed(1)} width={node.w} height={node.h} rx={8} />
                  <text x={node.x.toFixed(1)} y={(node.y - 3).toFixed(1)} textAnchor="middle">{node.label}</text>
                  <text className="count" x={node.x.toFixed(1)} y={(node.y + 14).toFixed(1)} textAnchor="middle">{t('page.map.features', { count })}</text>
                </g>
              );
            })}
          </g>
        </svg>
        <div className="legend" aria-hidden="true">
          <span><i className="out" />{t('page.map.legend.out')}</span>
          <span><i className="in" />{t('page.map.legend.in')}</span>
          {layout.centre !== null && <span>{t('page.map.legend.centre')}</span>}
        </div>
      </div>
      <aside className="atlas-side" aria-live="polite" data-part="atlas-side">
        {channel !== null && handovers[channel] !== undefined ? <SideChannel index={channel} /> : domain !== null ? <SideDomain id={domain} /> : <SideDefault />}
      </aside>
    </div>
  );
}
