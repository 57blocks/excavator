import ForceWorker from './force-layout.worker?worker&inline';

import type { LayoutWorker } from './force-layout-client';

/** A new layout worker; vite inlines its code, so the page starts it from a blob URL (the policy's `worker-src blob:`). */
export const createForceWorker = (): LayoutWorker => new ForceWorker();
