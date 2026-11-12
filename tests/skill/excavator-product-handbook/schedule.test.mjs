// Design D2 of openspec change handbook-summary-tables: the schedule of a job
// is read only from the string literals of its registration line, and lands in
// exactly one of three buckets.
import { describe, expect, it } from 'vitest';

import { scheduleBucket } from '../../../skills/excavator-product-handbook/lib/schedule.mjs';

const literal = (text) => ({ bucket: 'literal', literal: text });
const computed = { bucket: 'computed', literal: null };
const absent = { bucket: 'absent', literal: null };

describe('scheduleBucket: a literal schedule', () => {
  const cases = [
    ['a five-segment cron', "schedule.scheduleJob('0 9 * * *', () => send())", literal('0 9 * * *')],
    ['a six-segment cron', "c.AddFunc(\"0 0 12 * * ?\", cleanup)", literal('0 0 12 * * ?')],
    ['@every with a duration', 'c.AddFunc("@every 5m", poll)', literal('@every 5m')],
    ['@every with a compound duration', 'c.AddFunc("@every 1h30m", poll)', literal('@every 1h30m')],
    ['@daily', "cron.schedule('@daily', run)", literal('@daily')],
    ['the other descriptors', "register('@hourly'); register('@weekly')", literal('@hourly')],
    ['a name followed by a cron: the name is not a cron, the cron is the answer', "scheduleJob('nightly-report', '30 * * * * *', run)", literal('30 * * * * *')],
    ['a cron with step, list and range characters', "scheduleJob('*/15 8-18 1,15 * *', run)", literal('*/15 8-18 1,15 * *')],
    ['a cron with weekday and month names', "scheduleJob('0 9 * JAN MON-FRI', run)", literal('0 9 * JAN MON-FRI')],
    ['a cron with L, W and # characters', "scheduleJob('0 0 15W * 5#3', run)", literal('0 0 15W * 5#3')],
    ['a template literal without interpolation', 'scheduleJob(`0 9 * * *`, run)', literal('0 9 * * *')],
    ['a literal with spaces around it', "scheduleJob(' 0 9 * * * ', run)", literal('0 9 * * *')],
    ['the first cron literal when there are two', "a('0 1 * * *'); b('0 2 * * *')", literal('0 1 * * *')],
    ['a literal after a template that is computed: the literal wins', "f(`${m} * * * *`, '0 9 * * *')", literal('0 9 * * *')],
    ['a literal after an escaped quote inside another literal', "log('it\\'s', '5 4 * * *')", literal('5 4 * * *')],
  ];
  for (const [name, text, want] of cases) {
    it(name, () => expect(scheduleBucket(text)).toEqual(want));
  }
});

describe('scheduleBucket: worked out when the job is registered', () => {
  const cases = [
    ['a template with two interpolations', 'scheduleJob(`${m} ${h} * * *`, run)'],
    ['a template with one interpolation in a six-segment cron', 'scheduleJob(`${sec} 0 9 * * *`, run)'],
    ['a template whose interpolation holds braces and a nested string', "scheduleJob(`${pick({ a: '1' })} 9 * * *`, run)"],
  ];
  for (const [name, text] of cases) {
    it(name, () => expect(scheduleBucket(text)).toEqual(computed));
  }
});

describe('scheduleBucket: not in the text of the registration line', () => {
  const cases = [
    ['a configuration expression', 'c.AddFunc(settings.Jobs.CleanupSpec, cleanup)'],
    ['a variable', 'schedule.scheduleJob(spec, run)'],
    ['an ordinary string', "scheduleJob('hello world', run)"],
    ['a job name only', "scheduleJob('nightly-report', run)"],
    ['a sentence of five words', "scheduleJob('send the daily report now', run)"],
    ['four segments', "scheduleJob('0 9 * *', run)"],
    ['seven segments', "scheduleJob('0 0 9 * * * 2030', run)"],
    ['@every without a duration', "scheduleJob('@every', run)"],
    ['@every with a word', "scheduleJob('@every day', run)"],
    ['a descriptor that is not one', "scheduleJob('@reboot', run)"],
    ['a cron split over a concatenation', "scheduleJob('0 ' + hour + ' * * *', run)"],
    ['a template with interpolation whose shape is not a cron', 'scheduleJob(`${spec}`, run)'],
    ['a template with interpolation and four segments', 'scheduleJob(`${m} * * *`, run)'],
    ['no literal at all', 'scheduleJob(run)'],
    ['an empty line', ''],
    ['a literal cut by the length cap (no closing quote)', "scheduleJob('0 9 * * "],
    ['a template cut inside an interpolation', 'scheduleJob(`${compute(a, b'],
  ];
  for (const [name, text] of cases) {
    it(name, () => expect(scheduleBucket(text)).toEqual(absent));
  }
});
