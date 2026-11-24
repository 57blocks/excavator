import { useMemo } from "react";
import { hasInlineSource } from "../../../offline/inlineData";
import { useDashboardStore, activeTranslations } from "../../../store";
import { domainTitle, translatorOf, type Translate } from "../../nameTranslations";
import { externalLabel, siteText, type RelationSite, type UnitInfo } from "../../products/relations";
import { LinkButton } from "../shared/Controls";

/**
 * The words the Relations view shows for a unit, an external system and a reason: the translation from the page's
 * name table when it has one, with the English original beside it, else the English as the product writes it.
 * A unit id the product's unit list lacks is shown as the id.
 */

export const ARROW = String.fromCharCode(0x2192);

/** The name table's lookup, or undefined when the page holds none. */
export function useTranslate(): Translate | undefined {
  const table = useDashboardStore(activeTranslations);
  return useMemo(() => translatorOf(table), [table]);
}

/** A label with its English original beside it when it was translated. */
export function Translated({ english, translate }: { english: string; translate?: Translate }) {
  const { label, original } = domainTitle(english, translate);
  return (
    <span data-excavator-name={english}>
      {label}
      {original === null ? null : <span className="ml-1 text-text-muted">{`(${original})`}</span>}
    </span>
  );
}

/** The English words for a unit id or an external system id, for sorting and searching. */
export function targetEnglish(id: string, units: ReadonlyMap<string, UnitInfo>): string {
  return id.startsWith("external:") ? externalLabel(id) : units.get(id)?.name ?? id;
}

/** A unit id or an external system id as the page shows it. */
export function Target({ id, units, translate }: { id: string | null; units: ReadonlyMap<string, UnitInfo>; translate?: Translate }) {
  if (id === null) return null;
  return <Translated english={targetEnglish(id, units)} translate={translate} />;
}

/** The text a search box looks in for a target: its English words and their translation. */
export function targetWords(id: string | null, units: ReadonlyMap<string, UnitInfo>, translate?: Translate): string {
  if (id === null) return "";
  const english = targetEnglish(id, units);
  return `${english} ${translate?.(english) ?? ""}`;
}

/** `file:line` of a site as a link that opens the code viewer there, or as text when the page does not hold that file's source. */
export function SiteLink({ site }: { site: Pick<RelationSite, "file" | "line"> | null }) {
  const openCodeViewerAt = useDashboardStore((s) => s.openCodeViewerAt);
  const label = siteText(site);
  if (site === null || site.file === null || label === null) return null;
  const file = site.file;
  if (!hasInlineSource(file)) return <span className="font-mono text-[11px]" title="The source of this file is not in this page.">{label}</span>;
  const range: [number, number] | null = site.line === null ? null : [site.line, site.line];
  return (
    <span className="font-mono text-[11px]" data-excavator-site={label}>
      <LinkButton title={`Open ${label}`} onClick={() => openCodeViewerAt(file, range)}>{label}</LinkButton>
    </span>
  );
}
