import { codeHash, rangeText } from '../../lib/code';

/** A link to a file on the Code page, and to the lines of it when a range is given. The path is text, never markup. */
export function CodeLink({ path, range }: { path: string; range?: unknown }) {
  const lines = rangeText(range);
  return (
    <a href={codeHash(path, range)} title={`Open ${path}${lines ? ` at ${lines}` : ''} in the Code page`} className="font-mono text-[12.5px] [overflow-wrap:anywhere]">
      {path + (lines ? `:${lines}` : '')}
    </a>
  );
}
