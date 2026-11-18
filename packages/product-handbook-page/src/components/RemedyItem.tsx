import { Markdown } from './Markdown';

/**
 * One improvement suggestion in plain text: its problem lines (label and short title, no id, no link; the first three, the rest behind
 * a row that unfolds), then its sentence with the bold label, the citations of the technical view and no id group. `line` is where it
 * starts in the remedies chapter; the element has the id `<anchorPrefix><line>`. `problems` are the rows (`d3`, `r12`) the lines are for
 * (the ones its id groups name when not given). `process`, for an item written under a process, is its first row: the process name as a link.
 */
export function RemedyItem({ text, line, anchorPrefix = 'remedy-', problems, idPrefix, process }: { text: string; line: number; anchorPrefix?: string; problems?: readonly string[]; idPrefix: string; process?: { name: string; href: string } }) {
  return <Markdown source={`- ${text}`} idPrefix={idPrefix} remedyItem={{ lineOffset: line - 1, anchorPrefix, problemIds: problems, ...(process === undefined ? {} : { process }) }} />;
}
