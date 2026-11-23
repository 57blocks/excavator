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

  it('keys rpc by short service and method, external by host or name', () => {
    expect(normalizeAddress('rpc', { service: 'pkg.v1.UserService', method: 'GetUser' }).key).toBe('UserService/GetUser');
    expect(normalizeAddress('external', { name: 'Mailer', host: 'www.Mail.example.com:443' }).key).toBe('external:mail.example.com');
    expect(normalizeAddress('external', { name: 'Mailer' }).key).toBe('external:mailer');
  });
});

describe('pairCaller', () => {
  const recv = (method, path) => http(method, path);

  it('links the receiver with the most literal segments and reports ties as ambiguous', () => {
    const caller = http('GET', '/users/me');
    const result = pairCaller('http', caller, [recv('GET', '/users/:id'), recv('GET', '/users/me'), recv('POST', '/users/me')]);
    expect(result.bucket).toBe('linked');
    expect(result.receivers[0].key).toBe('GET /users/me');
    expect(pairCaller('http', http('GET', '/users/${id}'), [recv('GET', '/users/:id'), recv('ANY', '/users/me')]).bucket).toBe('ambiguous');
    expect(pairCaller('http', http('GET', '/users/${id}'), [recv('GET', '/users/me')])).toMatchObject({ bucket: 'linked', paramToLiteral: true });
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
