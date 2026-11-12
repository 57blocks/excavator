export const TicketStatus = {
  Open: 'open',
  // waiting for the customer
  Pending: 'pending',
  Closed: 'closed', // no further changes
  labels: { open: 'Open', pending: 'Pending' },
} as const;

const RetryMode = { Fast: 1, Slow: 2 } as const;

const LoosePhase = { a: 'x' };

const Settings = { retries: 3 } as const;

export const EmptyKind = { build: 1 + 1 } as const;

// const CommentedLevel = { a: 1 } as const;
