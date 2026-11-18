import { Markdown } from './Markdown';

/**
 * One improvement suggestion in plain text: its problem lines (label and short title, no id, no link; the first three, the rest behind
 * a row that unfolds), then its sentence with the bold label, the citations of the technical view and no id group. `line` is where it
 * starts in the remedies chapter; the element has the id `<anchorPrefix><line>`. `problems` are the rows (`d3`, `r12`) the lines are for
 * (the ones its id groups name when not given).
 */
export function RemedyItem({ text, line, anchorPrefix = 'remedy-', problems, idPrefix }: { text: string; line: number; anchorPrefix?: string; problems?: readonly string[]; idPrefix: string }) {
  return <Markdown source={`- ${text}`} idPrefix={idPrefix} remedyItem={{ lineOffset: line - 1, anchorPrefix, problemIds: problems }} />;
}
