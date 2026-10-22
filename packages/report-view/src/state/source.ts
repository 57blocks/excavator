import { useLoaded, useViewer, type Loaded } from './viewer';

/** The text of an embedded file, from the page's source payload (the Code page and the code drawer read it the same way). */
export function useEmbeddedText(path: string): Loaded<string> {
  const { payloads } = useViewer();
  return useLoaded(path, async () => {
    const texts = await payloads.parsed<Record<string, string>>('sources');
    if (!Object.hasOwn(texts, path)) throw new Error(`the page lists ${path} as embedded but holds no text for it`);
    return texts[path];
  });
}
