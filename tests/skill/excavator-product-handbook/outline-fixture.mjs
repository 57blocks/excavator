/**
 * The outline of openspec change handbook-outline for the tests: every block of the fixed list, grouped into parts
 * the way a test run might, and the helpers that write it. The ids are the fixed block ids (the page route names);
 * the titles are the test's own.
 */

import { join } from 'node:path';

export const BLOCK_IDS = ['overview', 'business', 'architecture', 'data', 'roles-matrix', 'applications-matrix', 'dictionaries', 'notifications', 'jobs', 'topics', 'history', 'findings', 'recommendations', 'open-questions', 'glossary', 'sources'];
export const LIST_IDS = ['domains', 'applications', 'systems'];
/** The blocks only the technical view has. */
export const TECHNICAL_IDS = ['architecture', 'data', 'applications-matrix', 'dictionaries', 'applications', 'systems'];

const chapter = (id, title) => (LIST_IDS.includes(id) ? { title, list: id } : { title, block: id });

/** A good outline: the lists of entities first, then everything else in three parts; a block with a title of its own. */
export function goodOutline(language = 'English') {
  return {
    format: 'excavator-product-handbook-outline/1',
    language,
    parts: [
      { title: 'Start here', chapters: [chapter('overview', 'What this product is'), chapter('business', 'How work moves'), chapter('domains', 'Work areas')] },
      { title: 'Who does what', chapters: [chapter('roles-matrix', 'People and permissions'), chapter('notifications', 'Messages sent'), chapter('jobs', 'Work done by itself'), chapter('topics', 'Questions across areas')] },
      { title: 'Under the hood', chapters: [chapter('architecture', 'How it is built'), chapter('applications', 'Programs'), chapter('systems', 'Outside services'), chapter('data', 'Stored data'), chapter('applications-matrix', 'Programs by area'), chapter('dictionaries', 'Status meanings')] },
      { title: 'Health', chapters: [chapter('history', 'How the code changed'), chapter('findings', 'What looks wrong'), chapter('recommendations', 'What to do about it'), chapter('open-questions', 'Not known yet'), chapter('glossary', 'Words used'), chapter('sources', 'What was read')] },
    ],
    unplaced: [],
  };
}

/** The same with `ids` moved out of their chapters into `unplaced`, each with a reason. */
export function outlineWithout(ids, language = 'English') {
  const outline = goodOutline(language);
  for (const part of outline.parts) part.chapters = part.chapters.filter((c) => !ids.includes(c.block ?? c.list));
  outline.parts = outline.parts.filter((part) => part.chapters.length > 0);
  outline.unplaced = ids.map((block) => ({ block, reason: 'Nothing readers need is in it.' }));
  return outline;
}

export const writeOutline = (run, outline = goodOutline()) => run.writeJson(join(run.out, 'outline.json'), outline);
