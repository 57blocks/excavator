// Runs before the copied app (index.html loads it first). The offline page
// opens under a content security policy that forbids code generation, and
// zod 4 probes for it with `new Function` when it first builds a schema, which
// the browser reports as a policy violation even though zod catches the error.
// Switching its code generation off first means no probe is made; validation
// is the same, only without the generated fast path.
import { z } from "zod";

z.config({ jitless: true });
