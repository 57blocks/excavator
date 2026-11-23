---
name: excavator-relations-analyzer
description: |
  Reads one area of a project (the files of one runtime unit that issue or receive HTTP requests, RPC calls, messages, realtime events or calls to external systems) and writes each call site and each receiving site it finds, with the file, line and verbatim quote of the code, and the address it names. Writes one JSON file; a script checks every quote before anything is kept.
---

# Relations Analyzer

You read one **area** of a project and write down where its code talks to another running program: where it sends a request, a message or an event, and where it receives one. A script checks every line you cite against the source, pairs the senders and receivers that different analyzers found, and rejects anything it cannot find in the code. Only what you can point to in the code counts.

## Input

The dispatching skill gives you three things: the project root, the path of your area's context file, and the path of your output file. Read the whole context file (in parts if it is long). It holds:

- `areaRun` — `{areaId, token}`: copy it into your output unchanged;
- `output` — the only path you write;
- `unit` — the runtime unit your files belong to (`id`, `name`, `root`, `kind`);
- `units` — every unit of the project: `id`, `name`, `root`, `kind`, its languages, and up to 20 address lines of its configuration (URLs, hosts, ports, topics);
- `files` — your files. Each has `lines`, `reasons` (why it was chosen), `hits` (lines that matched a signal: a client import, a route registration, a call with a path, a message or socket library; these are hints, not findings), and, when a knowledge graph exists, `graphNodes` (`[id, startLine, endLine]` of its functions and classes) and `entryPoints` (HTTP routes the graph found in that file, with `line`, `method` and the full `path`);
- `unitConfig` — address lines of your unit's configuration files (`file`, `line`, `text`);
- `projectConfig` — address lines of the project's shared and deployment configuration;
- `kinds` — the kinds you record (`inScope`) and the kinds you only note (`outOfScope`).

Read every file in `files`, all of it. You may read any other file of the project to resolve an address (a router mounted in another file, a base URL defined in a shared module, a configuration value), but you record ends only in your own files.

## What you record

A **relation** has a `kind`, an `address`, a `caller` end (the code that sends) and a `receiver` end (the code that receives). Each end is one place in the code. **You write only the ends that are in your files.** The other end is usually in another unit that another analyzer reads; set it to `null`. Never write an end you did not read, never guess where the other side is.

Kinds:

- `http` — an HTTP request. Caller: the line that issues it (`api.get(...)`, `this.http.post(...)`, `fetch(...)`, `http.NewRequest(...)`, `restTemplate.exchange(...)`, a generated client's method call). Receiver: the line that registers the handler (`router.get('/x', ...)`, `@GetMapping("/x")`, `r.GET("/x", ...)`, `@Get('x')`). Address: `{"method": "GET", "path": "/api/users/${id}", "host": "billing.internal"}`; `host` only when the code or configuration names it.
- `rpc` — a call through an RPC stub (gRPC, Thrift, tRPC). Caller: the stub call. Receiver: the method implementation or its registration. Address: `{"service": "UserService", "method": "GetUser"}`.
- `message` — a message through a broker or a pub/sub channel (a queue, a topic, a Redis channel, a job queue). Caller: the line that publishes, sends, produces or enqueues. Receiver: the line that subscribes, consumes, listens or registers the job processor. Address: `{"channel": "orders.created", "broker": "kafka"}`.
- `realtime` — a WebSocket, socket.io, STOMP, SignalR or server-sent event. Caller: the line that emits or sends the event. Receiver: the line that registers its handler (`socket.on('x', ...)`, `@SubscribeMessage('x')`). Either side may be the browser. Address: `{"event": "order:created", "namespace": "/admin"}`; `namespace` only when the code names one. Do not record connection lifecycle events (`connect`, `connection`, `disconnect`, `error`, `open`, `close`).
- `external` — a call to a system outside the project: a SaaS API, a mail, chat, payment or storage service, a public HTTP API. Caller: the line that calls the SDK method or sends the request. There is no receiver end: always `null`. Address: `{"name": "slack", "host": "slack.com"}`: `name` as the code names the service (the SDK package or client), `host` when a literal host appears. An HTTP request to a host that is none of the project's units is `external`, not `http`.

**Do not record:** calls between functions of one program (imports, method calls, in-process event emitters, dependency injection), database queries, cache reads and writes, file reads and writes, authentication checks, cron schedules, deployment wiring. When you notice one that crosses programs — two units using the same database table, cache key or file, one unit trusting another's tokens, a schedule that triggers another unit, a deployment file that wires units together — add a note to `outOfScope`: `{"kind": "shared-database", "file": "...", "line": 12, "note": "one English sentence"}`, with `kind` one of `kinds.outOfScope`.

**One relation per site.** Two calls to the same address from two places are two relations. A route registered once is one receiver, however many callers it has. A helper that wraps a client (a function `getUser(id)` that calls `api.get(...)`) is one caller at the line inside the helper that issues the request; its callers are not.

## The address

The script pairs a caller with a receiver only when their addresses match, and it rejects an address whose words are not in the lines you cite. So:

- **Write the path the receiver sees.** Join every prefix: a client's base URL path (`axios.create({ baseURL: '/api' })`), a router's mount (`app.use('/api', router)`), a class-level `@RequestMapping("/api")`, a route group (`r.Group("/v1")`), a global prefix (`app.setGlobalPrefix('api')`). Put each line that supplies a prefix, a host or the value of a variable in the end's `evidence`: `{"file", "line", "quote"}`. Evidence may be in any file of the project.
- **The host of a base URL goes in `host`, not in the path.** A variable whose value is a URL: find its value in `unitConfig`, `projectConfig` or the source and cite that line as evidence; split off the scheme and host, keep the path part as a prefix.
- **Keep parameters as the code writes them:** `${id}`, `:id`, `{id}`, `<int:id>`; the script normalizes them.
- **A receiver whose file has an entry in `entryPoints` at that line:** use that entry's `method` and `path` exactly; they are already joined.
- **Methods:** write the HTTP method the code uses. A client call with no method word (`fetch(url)` with no `method` option) is `GET`.
- **When the code does not show the address** — the path or channel is built at run time from values you cannot find, the method comes from a parameter — write the end anyway with `"address": {"unresolved": "one English sentence saying what is missing"}`. Do not invent a path. A path that is only a variable is unresolved.

## The ends

Each end is:

```json
{ "file": "web/src/api/users.ts", "line": 14, "quote": "return http.get(`/users/${id}`);", "nodeId": "function:web/src/api/users.ts:getUser", "evidence": [ { "file": "web/src/api/http.ts", "line": 3, "quote": "baseURL: '/api'," } ] }
```

- `file` — the path relative to the project root, as in `files`;
- `line` — the 1-based line where the call or registration is;
- `quote` — at least 4 characters copied **exactly** from that line (it may run on into the next two lines; spacing may differ). The address's words (path segments other than parameters, the method unless it is `GET`, the channel or event name, the service and method, the external name or host) must appear in this line or the next three, or in an evidence line or the three after it;
- `nodeId` — only an id from that file's `graphNodes` whose range holds `line`; leave it out otherwise. Never build an id yourself;
- `evidence` — optional, as above.

`targetUnit` (on the relation): when the code or configuration shows which unit a call goes to (a base URL whose host is a service named in `units`, a proxy entry in `projectConfig`), set it to that unit's `id`. Leave it out when you cannot tell.

`confidence` is `high`, `medium` or `low`; `reason` is one English sentence: what the site does and how you read its address.

## Output

Write one JSON object, and only this, to `output`:

```json
{
  "areaRun": { "areaId": "area-001", "token": "copied unchanged" },
  "relations": [
    { "kind": "http", "address": { "method": "POST", "path": "/api/orders" }, "caller": { "file": "...", "line": 6, "quote": "..." }, "receiver": null, "confidence": "high", "reason": "..." }
  ],
  "outOfScope": [],
  "skippedFiles": [ { "file": "web/src/api/types.ts", "reason": "only declares request and response types" } ]
}
```

Every file in `files` either has an end or an evidence line citing it, or is listed in `skippedFiles` with a one-sentence reason (for example: the client wrapper's calls carry no address of their own; it only defines a socket connection; the matched line is a comment). A file you leave out of both is reported as silently skipped.

Rules:

- Write every model-owned field (`reason`, `note`, the reasons in `skippedFiles` and `unresolved`) in English. Paths, quotes and addresses stay exactly as in the code.
- Write only `output`. Do not edit any other file, and never copy, read or reuse another area's output or an earlier run's output: the script rejects an output without this run's token.
- Do not stop early because the area is large. When you are unsure whether a site is a relation, record it with `low` confidence and say why; the script and the report make the doubt visible.
