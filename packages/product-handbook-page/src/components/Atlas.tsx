import { useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';

import { busiest, countsOf, groupByOther, handedOver, received } from '../lib/handovers';
import { useLinks, useView } from '../lib/links';
import { useModel } from '../lib/model';
import { colourProps } from '../lib/strata';
import type { Indexed } from '../lib/handovers';
import { useText } from '../lib/text';
import { plainText } from './InlineMarkdown';
import { DomainLink } from './Flows';
import { Mark } from './Mark';

const SPACE_OR_ENTER = (event: KeyboardEvent): boolean => event.key === 'Enter' || event.key === ' ';

/** The longest list of linked domains the panel shows in one column. */
const LONG_LIST = 6;

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

/** The panel of one domain: its name and intro (the product text when the page has it), the two lists of the domains at the other ends with their hand-over counts and the link to its page. */
function SideDomain({ id }: { id: string }) {
  const t = useText();
  const nav = useLinks();
  const view = useView();
  const { domains, colours, handovers } = useModel();
  const domain = domains[id];
  const outs = handedOver(handovers, id);
  const ins = received(handovers, id);
  // More than LONG_LIST domains go in two columns, so the panel of the busiest domain stays within the map's height.
  const list = (entries: Indexed[], side: 'from' | 'to') => {
    const groups = groupByOther(entries, side);
    return (
    <ul className="link-list" data-cols={groups.length > LONG_LIST ? '2' : undefined}>
      {groups.map((group) => (
        <li key={group.other} data-other={group.other}>
          <a className="link-row" href={nav.domain(group.other)} title={domains[group.other]?.name ?? group.other}><Mark colour={colours[group.other]} /><span className="link-name">{domains[group.other]?.name ?? group.other}</span><small className="link-count" data-part="link-count">{group.items.length}</small></a>
        </li>
      ))}
    </ul>
    );
  };
  return (
    <>
      <h3><Mark colour={colours[id]} /><a className="side-title-link" href={nav.domain(id)} title={t('page.flow.open', { name: domain.name })}>{domain.name}</a></h3>
      <p className="side-hint">{plainText(domain.intro.product ?? domain.intro[view] ?? '')}</p>
      {outs.length === 0 && ins.length === 0 && <p className="flow-none">{t('page.flow.none')}</p>}
      {outs.length > 0 && <div className="flows"><h4 className="dir-out">{t('page.flow.out', { count: outs.length })}</h4>{list(outs, 'to')}</div>}
      {ins.length > 0 && <div className="flows"><h4 className="dir-in">{t('page.flow.in', { count: ins.length })}</h4>{list(ins, 'from')}</div>}
    </>
  );
}

/** The panel of one hand-over: the two domains, no words. */
function SideChannel({ index }: { index: number }) {
  const t = useText();
  const { handovers, colours, domains } = useModel();
  const handover = handovers[index];
  return (
    <>
      <h3><Mark colour={colours[handover.from]} />{domains[handover.from].name}</h3>
      <p className="side-hint dir-out">{t('page.handover.out')} <DomainLink id={handover.to} /></p>
    </>
  );
}

/**
 * The atlas: the map of the domains with its side panel. A domain shows its panel on hover and on keyboard focus (when no line
 * is picked); its hand-overs are blue lines out and ochre lines in and everything else is dimmed. A click on a domain, or Enter
 * or Space on a focused one, selects it (it stays marked after the pointer leaves and hover no longer replaces it); a click on a
 * line selects that one hand-over instead; a click on the empty map, or Escape, clears the selection. The map never navigates:
 * the domain page opens from the panel.
 */
export function Atlas() {
  const t = useText();
  const nav = useLinks();
  const { layout, handovers, domains, colours } = useModel();
  const [picked, setPicked] = useState<number | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  if (layout === null) return null;

  const clear = () => { setPicked(null); setSelected(null); setHover(null); };
  const select = (id: string) => { setPicked(null); setHover(null); setSelected(id); };
  const idle = picked === null && selected === null;
  const domain = picked === null ? (selected ?? hover) : null;
  const channel = picked;
  const dimmed = domain !== null || channel !== null;
  const near = new Set<string>();
  for (const edge of layout.edges) {
    if (domain !== null && edge.from === domain) near.add(edge.to);
    if (domain !== null && edge.to === domain) near.add(edge.from);
    if (channel === edge.index) { near.add(edge.from); near.add(edge.to); }
  }
  const stop = (event: MouseEvent) => event.stopPropagation();

  return (
    <div className="atlas" data-part="atlas" onKeyDown={(event) => { if (event.key === 'Escape') clear(); }}>
      <div className="atlas-map">
        <svg viewBox={`0 0 ${layout.viewBox.w} ${layout.viewBox.h}`} role="group" aria-label={t('page.map.label')} className={dimmed ? 'focus' : undefined} onClick={clear}>
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
                  <path className="edge-hit" d={edge.d} onClick={(event) => { stop(event); setSelected(null); setHover(null); setPicked(edge.index); }}><title>{t('page.map.edge', { from: domains[edge.from].name, to: domains[edge.to].name })}</title></path>
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
                  aria-pressed={node.id === selected}
                  aria-label={t('page.map.node', { name, count })}
                  onMouseEnter={() => { if (idle) setHover(node.id); }}
                  onMouseLeave={() => { if (idle) setHover(null); }}
                  onFocus={() => { if (idle) setHover(node.id); }}
                  onBlur={() => { if (idle) setHover(null); }}
                  onClick={(event) => { stop(event); select(node.id); }}
                  onKeyDown={(event) => { if (SPACE_OR_ENTER(event)) { event.preventDefault(); select(node.id); } }}
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
