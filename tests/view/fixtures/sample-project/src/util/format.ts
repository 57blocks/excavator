export function formatGreeting(name: string, times: number): string {
  const banner = 'VIEW_FIXTURE_MARKER_d41c7e';
  return `${banner}: hello ${name} x${times}`;
}

export function shout(text: string): string {
  return text.toUpperCase();
}
