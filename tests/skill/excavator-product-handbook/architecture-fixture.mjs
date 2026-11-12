/**
 * A run for the tests of openspec change handbook-architecture-chapter: a copy of the fixture project turned into three
 * application roots (apps/web, apps/api, apps/jobs), a checked map, and a good chapter and fact sheet next to it.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { clone, makeCheckedMapRun, runHandbook } from './helpers.mjs';

export const WEB = 'apps/web/package.json';
export const API = 'apps/api/package.json';
export const JOBS = 'apps/jobs/package.json';
const ev = (file, passage) => ({ file, passage });
const cite = (file, range = '1') => `\`${file}:${range}\``;

export const GOOD_ARCH_CHAPTER = `# Architecture

## Applications

The web application is a browser client (${cite(WEB)}). The api service answers its requests (${cite(API)}).

<!-- no-diagram: the fixture has no request path -->
`;

export const goodArchitecture = () => ({
  format: 'excavator-product-handbook-architecture/1',
  components: [
    { id: 'c1', label: 'Clerks', kind: 'users', evidence: [ev('src/app.js', 'const app = express();')] },
    { id: 'c2', label: 'Web client', kind: 'frontend', application: 'apps/web', stack: 'Browser client', evidence: [ev(WEB, '"name": "web-client"')] },
    { id: 'c3', label: 'Api service', kind: 'backend', application: 'apps/api', stack: 'Node service on port 4000', evidence: [ev(API, '"name": "api-service"')] },
    { id: 'c4', label: 'Job runner', kind: 'backend', application: 'apps/jobs', evidence: [ev(JOBS, '"name": "job-runner"')] },
    { id: 'c5', label: 'Order store', kind: 'database', evidence: [ev('src/app.js', "app.use('/orders', ordersRouter);")] },
    { id: 'c6', label: 'Mail service', kind: 'external', evidence: [ev('src/app.js', "app.use('/archive', archiveRouter);")] },
  ],
  links: [
    { from: 'c1', to: 'c2', text: 'uses', evidence: [ev('src/app.js', 'const app = express();')] },
    { from: 'c2', to: 'c3', text: 'calls', evidence: [ev(API, '"name": "api-service"')] },
    { from: 'c3', to: 'c5', text: 'reads and writes', evidence: [ev('src/app.js', "app.use('/orders', ordersRouter);")] },
    { from: 'c4', to: 'c6', text: 'sends mail', evidence: [ev(JOBS, '"name": "job-runner"')] },
  ],
  unknowns: [{ item: 'Where the cache runs', searched: 'the manifests of the three applications' }],
});

/** A checked map run whose project has the three application roots; `write` puts the good files in. */
export function archRun({ write = true } = {}) {
  const run = makeCheckedMapRun();
  rmSync(join(run.root, 'package.json'));
  for (const [file, name] of [[WEB, 'web-client'], [API, 'api-service'], [JOBS, 'job-runner']]) {
    mkdirSync(join(run.root, file, '..'), { recursive: true });
    writeFileSync(join(run.root, file), `{\n  "name": "${name}"\n}\n`);
  }
  run.strict = (command, ...args) => runHandbook([command, run.out, ...args, '--project', run.root], { env: { EXCAVATOR_HANDBOOK_ALLOW_V2_ENTRY: '' } });
  run.writeArch = (doc = goodArchitecture()) => writeFileSync(join(run.out, 'architecture.json'), `${JSON.stringify(doc, null, 2)}\n`);
  run.writeChapter = (text = GOOD_ARCH_CHAPTER) => {
    mkdirSync(join(run.out, 'chapters'), { recursive: true });
    writeFileSync(join(run.out, 'chapters', 'architecture.md'), text);
  };
  run.state = () => JSON.parse(readFileSync(join(run.out, 'state.json'), 'utf-8'));
  if (write) {
    run.writeArch();
    run.writeChapter();
  }
  return run;
}

export { clone };
