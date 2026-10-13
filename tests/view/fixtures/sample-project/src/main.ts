import { formatGreeting } from './util/format';
import { Counter } from './counter';

export function run(name: string): string {
  const counter = new Counter();
  counter.increment();
  return formatGreeting(name, counter.value());
}
