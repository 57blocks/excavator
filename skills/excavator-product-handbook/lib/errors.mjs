/** A usage or IO error: the calling command prints its message and exits 2. */
export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}
