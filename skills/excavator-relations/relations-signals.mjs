/**
 * relations-signals.mjs
 *
 * The data the relations skill uses to choose which files an analyzer reads,
 * and the shared file helpers of its scripts. Nothing here decides a
 * relation: a signal is one line that looks like a client import, a route
 * registration, a subscription or a call with a path, and it only puts the
 * file in front of an analyzer, with the matching lines as hints. The
 * analyzer writes the relations and merge-relations.mjs checks every one of
 * them against the source.
 *
 * Signals are a table, not code branches: each row is { id, family, pattern },
 * where `family` says what kind of line it is:
 *   client     a library or annotation that makes outbound calls; a file with
 *              one is a "client definition", and files importing it are
 *              candidates too (a wrapped axios instance, a generated client);
 *   server     a route, a handler or a gateway registration;
 *   call       a call shape with a path or an event-name argument, whatever
 *              the library (a server handed its socket.io instance as a
 *              parameter imports nothing);
 *   message    a queue, topic or pub/sub library or annotation;
 *   realtime   a WebSocket or socket.io library or annotation;
 *   rpc        an RPC framework;
 *   external   an SDK of an external system (SaaS API, mail, storage).
 * A missing row means a file that never reaches an analyzer; that loss is not
 * visible in the coverage report and is estimated by the acceptance checks.
 */

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';

export const SIGNALS_VERSION = 2;

const lib = (names) => names.map((n) => n.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|');
/** An import, require or Go/Java/Python import of one of the named modules (prefix match). */
const importOf = (names) => `(?:from\\s+|require\\(\\s*|import\\s+|import\\s*\\(\\s*)['"\`](?:${lib(names)})(?:['"\`/])`;

export const SIGNALS = Object.freeze([
  // Outbound HTTP clients.
  { id: 'js-http-client', family: 'client', pattern: importOf(['axios', 'ky', 'got', 'node-fetch', 'superagent', 'undici', 'ofetch', 'cross-fetch', 'isomorphic-fetch', 'request', 'needle', 'redaxios', 'wretch']) },
  { id: 'angular-http-client', family: 'client', pattern: '@angular/common/http' },
  { id: 'fetch-call', family: 'client', pattern: '(?:^|[^\\w.])fetch\\s*\\(' },
  { id: 'nuxt-fetch', family: 'client', pattern: '\\$fetch\\s*\\(|useFetch\\s*\\(' },
  { id: 'go-http-client', family: 'client', pattern: 'http\\.(?:Get|Post|PostForm|Head|NewRequest|NewRequestWithContext)\\s*\\(|&http\\.Client\\b|http\\.DefaultClient|go-resty/resty' },
  { id: 'jvm-http-client', family: 'client', pattern: '\\b(?:RestTemplate|WebClient|RestClient|OkHttpClient|HttpClient\\.newHttpClient|CloseableHttpClient|Retrofit)\\b|@FeignClient|@HttpExchange' },
  { id: 'python-http-client', family: 'client', pattern: '^\\s*(?:import|from)\\s+(?:requests|httpx|aiohttp|urllib3)\\b' },
  { id: 'dotnet-http-client', family: 'client', pattern: '\\bHttpClient\\s*\\(|IHttpClientFactory|RestSharp' },
  { id: 'openapi-client', family: 'client', pattern: 'openapi-fetch|@hey-api/|orval|openapi-typescript-codegen|ts-rest|@trpc/client' },
  // Route and handler registration.
  { id: 'js-route', family: 'server', pattern: '\\b(?:app|router|server|route|routes|api|fastify)\\.(?:get|post|put|patch|delete|all|head|options|route)\\s*\\(' },
  { id: 'go-route', family: 'server', pattern: '\\.(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|Any|Handle|HandleFunc|Group)\\s*\\(\\s*"' },
  { id: 'go-net-http-route', family: 'server', pattern: 'http\\.(?:HandleFunc|Handle)\\s*\\(' },
  { id: 'jvm-route', family: 'server', pattern: '@(?:Get|Post|Put|Patch|Delete|Request)Mapping\\b|@(?:Rest)?Controller\\b|@Path\\s*\\(|@(?:GET|POST|PUT|DELETE|PATCH)\\b' },
  { id: 'nest-route', family: 'server', pattern: '@(?:Get|Post|Put|Patch|Delete|All|Head|Options)\\s*\\(|@Controller\\s*\\(' },
  { id: 'python-route', family: 'server', pattern: '@(?:app|router|bp|blueprint|api)\\.(?:get|post|put|patch|delete|route|websocket)\\s*\\(|\\bpath\\s*\\(\\s*r?[\'"]' },
  { id: 'dotnet-route', family: 'server', pattern: '\\[(?:Http(?:Get|Post|Put|Patch|Delete)|Route)\\b|\\.Map(?:Get|Post|Put|Patch|Delete)\\s*\\(' },
  // A call with a path argument, whatever the receiver: catches wrapped clients.
  { id: 'path-call', family: 'call', pattern: '\\.(?:get|post|put|patch|delete|head|options|request)\\s*(?:<[^>()]*>)?\\s*\\(\\s*[\'"`](?:/|\\$\\{)' },
  // RPC.
  { id: 'grpc', family: 'rpc', pattern: 'google\\.golang\\.org/grpc|@grpc/grpc-js|grpc-web|io\\.grpc|\\bgrpc\\.(?:Dial|NewClient|NewServer)\\b|@GrpcMethod|@GrpcService|ClientGrpc|import\\s+grpc\\b' },
  { id: 'thrift', family: 'rpc', pattern: 'apache/thrift|org\\.apache\\.thrift|\\bthrift\\b' },
  { id: 'trpc', family: 'rpc', pattern: '@trpc/server|initTRPC' },
  // Async messaging.
  { id: 'message-library', family: 'message', pattern: importOf(['amqplib', 'amqp-connection-manager', 'kafkajs', 'node-rdkafka', 'bull', 'bullmq', 'bee-queue', 'nats', 'mqtt', 'ioredis', 'redis', '@aws-sdk/client-sqs', '@aws-sdk/client-sns', '@google-cloud/pubsub', '@azure/service-bus', '@nestjs/microservices', '@nestjs/bull', '@nestjs/bullmq', 'github.com/segmentio/kafka-go', 'github.com/Shopify/sarama', 'github.com/IBM/sarama', 'github.com/rabbitmq/amqp091-go', 'github.com/streadway/amqp', 'github.com/nats-io', 'github.com/redis/go-redis', 'github.com/go-redis/redis', 'pika', 'kafka', 'celery']) },
  { id: 'message-annotation', family: 'message', pattern: '@(?:KafkaListener|RabbitListener|JmsListener|SqsListener|StreamListener|EventPattern|MessagePattern|Processor|Process|OnEvent)\\b|\\b(?:KafkaTemplate|RabbitTemplate|JmsTemplate|AmqpTemplate|ApplicationEventPublisher)\\b' },
  { id: 'redis-pubsub', family: 'message', pattern: '\\.(?:publish|subscribe|psubscribe)\\s*\\(\\s*[\'"`]' },
  // Real-time events.
  { id: 'realtime-library', family: 'realtime', pattern: importOf(['socket.io', 'socket.io-client', 'ws', 'sockjs-client', '@stomp/stompjs', 'stompjs', '@microsoft/signalr', '@nestjs/websockets', 'github.com/gorilla/websocket', 'nhooyr.io/websocket', 'github.com/googollee/go-socket.io', 'pusher', 'pusher-js', 'ably', 'centrifuge']) },
  { id: 'socket-event-call', family: 'call', pattern: '(?:\\bio|\\bsocket[A-Za-z]*|\\bnsp|\\bnamespace|\\.get\\(\\s*[\'"]io[\'"]\\s*\\))(?:\\.(?:to|in|of|broadcast)\\b(?:\\([^)]*\\))?)*\\.(?:emit|on|once)\\s*\\(\\s*[\'"`]' },
  { id: 'realtime-api', family: 'realtime', pattern: 'new\\s+WebSocket\\s*\\(|new\\s+EventSource\\s*\\(|@WebSocketGateway|@SubscribeMessage|@MessageMapping|SimpMessagingTemplate|SseEmitter|@ServerEndpoint' },
  // External systems.
  { id: 'external-sdk', family: 'external', pattern: importOf(['@slack/', 'jira-client', 'jira.js', 'stripe', '@sendgrid/', 'nodemailer', 'mailgun', 'mailgun.js', 'twilio', '@aws-sdk/client-s3', '@aws-sdk/client-ses', 'aws-sdk', '@google-cloud/storage', 'firebase-admin', 'googleapis', '@octokit/', 'openai', '@anthropic-ai/', 'minio', '@azure/storage-blob', 'github.com/slack-go/slack', 'github.com/andygrunwald/go-jira', 'github.com/aws/aws-sdk-go', 'github.com/stripe/stripe-go', 'net/smtp', 'gopkg.in/gomail', 'github.com/sendgrid', 'boto3', 'smtplib']) },
  { id: 'external-annotation', family: 'external', pattern: '\\bJavaMailSender\\b|\\bAmazonS3\\b|\\bS3Client\\b|\\bSmtpClient\\b' },
].map((row) => ({ ...row, regex: new RegExp(row.pattern) })));

/** Families whose files are client definitions: files importing them are candidates too. */
export const CLIENT_FAMILIES = Object.freeze(new Set(['client', 'message', 'realtime', 'rpc', 'external']));

export const SOURCE_EXTENSIONS = Object.freeze(new Set([
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts', '.vue', '.svelte', '.go', '.java', '.kt', '.kts', '.scala',
  '.groovy', '.py', '.rb', '.php', '.cs', '.rs', '.dart', '.swift',
]));

/** Directories never walked: dependencies, build output, tool state. Dot directories are skipped too. */
export const IGNORED_DIRS = Object.freeze(new Set([
  'node_modules', 'bower_components', 'vendor', 'dist', 'build', 'out', 'target', 'coverage', '__pycache__', 'venv', 'env',
  'site-packages', 'www', 'platforms', 'Pods', 'obj',
]));

const TEST_FILE = /(?:\.test\.|\.spec\.|\.e2e\.|__tests__\/|__mocks__\/|_test\.go$|_test\.py$|(?:^|\/)test_\w+\.py$|(?:^|\/)(?:e2e|cypress|playwright|test|tests|spec|testing)\/|(?:^|\/)src\/(?:test|gatling)\/)/;
export function isTestFile(path) {
  return TEST_FILE.test(path);
}

const CONFIG_FILE = /(?:^|\/)(?:\.env(?:\.[\w.-]+)?|[^/]+\.(?:ya?ml|properties|toml|conf|ini)|environment[\w.-]*\.ts|[^/]*config[^/]*\.(?:js|ts|mjs|cjs|json)|config\/[^/]+\.(?:js|ts|mjs|cjs|json)|docker-compose[^/]*|Dockerfile[^/]*|proxy\.conf[^/]*|appsettings[^/]*\.json|nginx[^/]*)$/i;
export function isConfigFile(path) {
  if (/(?:^|\/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|tsconfig[^/]*\.json|\.eslintrc[^/]*|jest\.config[^/]*|vitest\.config[^/]*|karma\.conf[^/]*|babel\.config[^/]*|tailwind\.config[^/]*|postcss\.config[^/]*|prettier[^/]*)$/i.test(path)) return false;
  return CONFIG_FILE.test(path);
}

/** A configuration line that names an address, a port or a channel. */
const ADDRESS_LINE = /(?:https?|wss?|amqps?|redis|nats|kafka|mqtt|grpc):\/\/|\b[\w.-]*(?:URL|URI|HOST|ENDPOINT|BASE|PORT|TOPIC|QUEUE|CHANNEL|EXCHANGE|BROKER|PROXY|TARGET|API)[\w.-]*\s*[:=]/i;
/** A configuration line whose key looks like a secret: never copied into a context. */
const SECRET_LINE = /(?:SECRET|PASSWORD|PASSWD|TOKEN|CREDENTIAL|PRIVATE|API[_-]?KEY|ACCESS[_-]?KEY|AUTH[_-]?KEY|\bKEY\b)/i;

export function isAddressLine(text) {
  return ADDRESS_LINE.test(text) && !SECRET_LINE.test(text);
}

export const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
export const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
export const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/** Every file under root, project-relative POSIX paths, sorted; skips IGNORED_DIRS and dot directories. */
export function walkProject(root) {
  const out = [];
  const visit = (rel) => {
    let entries;
    try {
      entries = readdirSync(rel ? join(root, rel) : root, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || IGNORED_DIRS.has(entry.name)) continue;
        visit(path);
      } else if (entry.isFile()) {
        out.push(path);
      }
    }
  };
  visit('');
  return out.sort(compare);
}

export const MAX_FILE_BYTES = 1_000_000;
const MINIFIED_LINE = 2000;

/** The lines of a project file, or null when unreadable, too large or minified. */
export function readSourceLines(root, file) {
  const path = join(root, file);
  try {
    if (statSync(path).size > MAX_FILE_BYTES) return null;
    const text = readFileSync(path, 'utf-8');
    const lines = text.split(/\r?\n/);
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    if (lines.some((l) => l.length > MINIFIED_LINE)) return null;
    return lines;
  } catch {
    return null;
  }
}

const LANGUAGE_FAMILIES = Object.freeze({
  '.js': 'js', '.jsx': 'js', '.mjs': 'js', '.cjs': 'js', '.ts': 'js', '.tsx': 'js', '.mts': 'js', '.cts': 'js', '.vue': 'js', '.svelte': 'js',
  '.go': 'go', '.java': 'jvm', '.kt': 'jvm', '.kts': 'jvm', '.scala': 'jvm', '.groovy': 'jvm', '.py': 'python', '.rb': 'ruby',
  '.php': 'php', '.cs': 'dotnet', '.rs': 'rust', '.dart': 'dart', '.swift': 'swift',
});

/**
 * The language family of a source file. Two ends in different families run in
 * different processes even inside one unit (a browser app bundled with its
 * server), so pairing treats (unit, family) as the side of a relation.
 */
export function languageFamilyOf(file) {
  return LANGUAGE_FAMILIES[extensionOf(file)] ?? 'other';
}

export function extensionOf(file) {
  const base = posix.basename(file);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot).toLowerCase() : '';
}

/**
 * The parts of a knowledge graph the relations scripts use, read line by line
 * so record kinds the store does not know (entryPoint) are still read.
 * Returns null when the file does not exist.
 */
export function readGraphFacts(path) {
  if (!path || !existsSync(path)) return null;
  const nodes = new Map();
  const imports = [];
  const entryPoints = [];
  let factsDigest = null;
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    if (!line) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (record.record === 'header') factsDigest = record.fields?.project?.factsDigest ?? null;
    else if (record.record === 'node' && isObject(record.node) && typeof record.node.id === 'string') {
      const n = record.node;
      nodes.set(n.id, { id: n.id, type: n.type, filePath: typeof n.filePath === 'string' ? n.filePath : null, lineRange: Array.isArray(n.lineRange) ? n.lineRange : null });
    } else if (record.record === 'edge' && record.edge?.type === 'imports') {
      imports.push([record.edge.source, record.edge.target]);
    } else if (record.record === 'entryPoint' && isObject(record.entryPoint)) {
      entryPoints.push(record.entryPoint);
    }
  }
  return { nodes, imports, entryPoints, factsDigest };
}

/** HTTP route entry points of a graph, keyed by file. */
export function httpEntryPointsByFile(facts) {
  const byFile = new Map();
  for (const entry of facts?.entryPoints ?? []) {
    if (entry?.routeKind !== 'http' || typeof entry.file !== 'string') continue;
    if (!byFile.has(entry.file)) byFile.set(entry.file, []);
    byFile.get(entry.file).push({ line: entry.line, method: entry.method ?? null, path: entry.path ?? null, bucket: entry.bucket ?? null });
  }
  return byFile;
}

export default { SIGNALS, SIGNALS_VERSION, walkProject, readSourceLines, readGraphFacts, isTestFile, isConfigFile, isAddressLine };
