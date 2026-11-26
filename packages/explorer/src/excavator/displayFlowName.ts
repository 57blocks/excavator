import { domainTitle, type Translate } from "./nameTranslations";

/**
 * The Domain view shows names, not code: a flow name that ends with its route in parentheses ("List (GET /v2/x)") is
 * shown without it. Display only; the data keeps the name as written.
 */

const TRAILING_ROUTE = /\s*[(\uff08]\s*(?:(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|ANY)\b|\/)[^()\uff08\uff09]*[)\uff09]\s*$/i;

/** The name without one trailing parenthesised route (ASCII or full-width parentheses); unchanged when nothing else would be left. */
export function displayFlowName(name: string): string {
  const stripped = name.replace(TRAILING_ROUTE, "");
  return stripped.trim() === "" ? name : stripped;
}

/** A flow's translated label and the English original beside it, both without the route. */
export function flowTitle(name: string, translate?: Translate): { label: string; original: string | null } {
  const { label, original } = domainTitle(name, translate);
  return { label: displayFlowName(label), original: original === null ? null : displayFlowName(original) };
}
