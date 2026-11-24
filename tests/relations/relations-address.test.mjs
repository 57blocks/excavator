/**
 * relations-address.mjs — fixed normalization and pairing rules.
 */
import { describe, expect, it } from 'vitest';
import { normalizeAddress, pairCaller } from '../../skills/excavator-relations/relations-address.mjs';

const http = (method, path) => normalizeAddress('http', { method, path });

describe('normalizeAddress', () => {
  it('normalizes http paths, parameters and wildcards', () => {
    expect(http('get', 'https://api.example.com:8443/v1//users/${id}/?q=1#x')).toMatchObject({
      ok: true, key: 'GET /v1/users/{}', address: { method: 'GET', path: '/v1/users/{}', host: 'api.example.com' }, literals: ['v1', 'users'], methodWord: null,
    });
    expect(http('POST', '/users/:id/{tab}/<x>/[slug]').key).toBe('POST /users/{}/{}/{}/{}');
    expect(http('GET', '/p/{name:[^/]+}/g/{id:\\d{1,3}}').key).toBe('GET /p/{}/g/{}');
    expect(http('ANY', '/static/**/a/b').key).toBe('ANY /static/{*}');
    expect(http('get', '/a/${base + "/x"}').segments).toHaveLength(2);
    expect(http('POST', '/a').methodWord).toBe('POST');
  });

  it('makes an address with no literal part, no method or an unresolved mark unresolved', () => {
    expect(http('GET', '${url}')).toEqual({ ok: false, reason: 'path has no literal segment' });
    expect(normalizeAddress('http', { path: '/a' })).toEqual({ ok: false, reason: 'no method' });
    expect(normalizeAddress('http', { unresolved: 'base URL comes from a variable' })).toEqual({ ok: false, reason: 'base URL comes from a variable' });
    expect(normalizeAddress('message', { channel: '${topic}' })).toEqual({ ok: false, reason: 'channel has no literal part' });
    expect(normalizeAddress('http', null).ok).toBe(false);
  });

  it('keeps colons in channels and writes placeholders as {}', () => {
    expect(normalizeAddress('realtime', { event: 'order:created' }).key).toBe('order:created');
    expect(normalizeAddress('message', { channel: 'orders.${region}.created' })).toMatchObject({ key: 'orders.{}.created', literals: ['orders.', '.created'] });
  });

  it('keys rpc by short service and method', () => {
    expect(normalizeAddress('rpc', { service: 'pkg.v1.UserService', method: 'GetUser' }).key).toBe('UserService/GetUser');
  });
});

describe('external ids', () => {
  const ext = (address) => normalizeAddress('external', address);
  const id = (address) => ext(address).key;

  it('gives one site the same id however the analyzer names it', () => {
    // A name alone and the same name with the provider's API host.
    expect(id({ name: 'acmeai' })).toBe(id({ name: 'acmeai', host: 'api.acmeai.com' }));
    expect(id({ name: 'openai' })).toBe(id({ name: 'openai', host: 'api.openai.com' }));
    // Two names for one host: the host decides, and a provider's API domain joins the provider.
    expect(id({ name: 'google', host: 'maps.googleapis.com' })).toBe(id({ name: 'googleapis', host: 'maps.googleapis.com' }));
    expect(id({ name: 'google', host: 'docs.google.com' })).toBe(id({ name: 'googleapis', host: 'maps.googleapis.com' }));
    // A short name and a domain written as the name, under a two-label public suffix.
    expect(id({ name: 'registry', host: 'm.registry.gov.uk' })).toBe(id({ name: 'registry.gov.uk', host: 'm.registry.gov.uk' }));
    expect(id({ name: 'registry.gov.uk' })).toBe('external:registry');
    // A storage SDK, a library bound to that storage service and the service's own name.
    expect(id({ name: 'S3' })).toBe(id({ name: 'multer-s3' }));
    expect(id({ name: 's3' })).toBe(id({ name: 'aws-s3', host: 'amazonaws.com' }));
    expect(id({ name: '@aws-sdk/client-s3' })).toBe('external:aws');
    // A tenant subdomain of a SaaS provider and the provider's product name.
    expect(id({ name: 'jira' })).toBe(id({ name: 'atlassian', host: 'team.atlassian.net' }));
    expect(id({ name: 'go-jira' })).toBe('external:atlassian');
    expect(id({ name: 'slack-go' })).toBe(id({ name: '@slack/web-api' }));
    expect(id({ name: 'google-sheets' })).toBe('external:google');
    // A mail transport that names its SMTP host keys on the host's provider.
    expect(id({ name: 'nodemailer', host: 'email-smtp.us-east-1.amazonaws.com' })).toBe(id({ name: 'smtp', host: 'email-smtp.us-east-1.amazonaws.com' }));
    expect(id({ name: 'x', host: 'https://API.Example.com:8443/v1/chat' })).toBe('external:example');
  });

  it('says what the id rests on and keeps the analyzer\'s words as labels only', () => {
    expect(ext({ name: 'OpenAI', host: 'api.openai.com' })).toMatchObject({ ok: true, key: 'external:openai', keyBy: 'host', address: { name: 'openai', host: 'api.openai.com' } });
    expect(ext({ name: 'Stripe' })).toMatchObject({ ok: true, key: 'external:stripe', keyBy: 'service' });
    expect(ext({ name: 'acmeai' })).toMatchObject({ ok: true, key: 'external:acmeai', keyBy: 'name' });
  });

  it('never makes a library or transport the service', () => {
    for (const name of ['axios', 'fetch', 'node-fetch', 'nodemailer', 'multer', 'ldapjs', 'ldap', 'smtp', 'mail', 'requests', 'resty']) {
      const result = ext({ name });
      expect(result.ok, name).toBe(false);
      expect(result.reason, name).toMatch(/library or protocol/);
      expect(result.transport, name).toBe(true);
    }
    // With a host, the host decides.
    expect(ext({ name: 'axios', host: 'api.vendor.io' })).toMatchObject({ ok: true, key: 'external:vendor', keyBy: 'host' });
  });

  it('keeps a name it cannot canonicalise as its own id, never merged with another', () => {
    expect(id({ name: 'Acme-Billing' })).toBe('external:acmebilling');
    expect(id({ name: 'acme-billing' })).not.toBe(id({ name: 'acme' }));
    expect(ext({ name: 'acme-billing' }).keyBy).toBe('name');
  });

  it('keys a hosted app by its whole host, an address or a bare host by itself, and ignores a host that is not one', () => {
    expect(id({ host: 'one.herokuapp.com' })).not.toBe(id({ host: 'two.herokuapp.com' }));
    expect(id({ host: 'one.herokuapp.com' })).toBe('external:one.herokuapp.com');
    expect(id({ host: '10.0.0.5:8080' })).toBe('external:10.0.0.5');
    expect(id({ host: 'billing' })).toBe('external:billing');
    expect(ext({ name: 'stripe', host: '${API_HOST}' })).toMatchObject({ key: 'external:stripe', keyBy: 'service' });
    expect(ext({ host: '${API_HOST}' })).toMatchObject({ ok: false });
  });
});

describe('pairCaller', () => {
  const recv = (method, path) => http(method, path);

  it('links the receiver with the most literal segments, never reads a caller variable as a word, and reports ties as ambiguous', () => {
    const caller = http('GET', '/users/me');
    const result = pairCaller('http', caller, [recv('GET', '/users/:id'), recv('GET', '/users/me'), recv('POST', '/users/me')]);
    expect(result.bucket).toBe('linked');
    expect(result.receivers[0].key).toBe('GET /users/me');
    const tie = pairCaller('http', http('GET', '/users/${id}'), [recv('GET', '/users/:id'), recv('ANY', '/users/me')]);
    expect(tie.bucket).toBe('linked');
    expect(tie.receivers[0].key).toBe('GET /users/{}');
    expect(pairCaller('http', http('GET', '/users/${id}'), [recv('GET', '/users/me'), recv('GET', '/users/all')]).bucket).toBe('caller-only');
    expect(pairCaller('http', http('GET', '/users/${id}'), [recv('GET', '/users/:id'), recv('GET', '/users/:name')]).bucket).toBe('ambiguous');
    expect(pairCaller('http', http('GET', '/users/${id}'), [recv('GET', '/users/me')]).bucket).toBe('caller-only');
    // A literal caller segment may meet a receiver parameter, a caller variable never a receiver word.
    expect(pairCaller('http', http('GET', '/p/${id}/feeds'), [recv('GET', '/p/plan/:year')]).bucket).toBe('caller-only');
    expect(pairCaller('http', http('GET', '/p/plan/2024'), [recv('GET', '/p/plan/:year')]).bucket).toBe('linked');
    expect(pairCaller('http', http('GET', '/files/a/b'), [recv('GET', '/files/**')]).bucket).toBe('linked');
    expect(pairCaller('http', http('GET', '/other'), [recv('GET', '/users')]).bucket).toBe('caller-only');
  });

  it('broadcasts messages to every receiver and marks several rpc servers ambiguous', () => {
    const channel = (c) => normalizeAddress('message', { channel: c });
    expect(pairCaller('message', channel('a.b'), [channel('a.b'), channel('a.b'), channel('a.c')]).receivers).toHaveLength(2);
    const rpc = () => normalizeAddress('rpc', { service: 'S', method: 'M' });
    expect(pairCaller('rpc', rpc(), [rpc(), rpc()]).bucket).toBe('ambiguous');
    const ns = (n) => normalizeAddress('realtime', { event: 'e', namespace: n });
    expect(pairCaller('realtime', ns('/a'), [ns('/b')]).bucket).toBe('caller-only');
  });
});
