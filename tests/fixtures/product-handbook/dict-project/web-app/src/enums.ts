export enum InvoiceState {
  Open = 'open',
  Paid = 'paid',
  Void = 'void',
  Refunded = 'refunded',
}

// Order priority, lowest first.
export const enum Priority {
  Low,
  Normal,
  High = 10,
  Urgent,
}

enum Mixed {
  A = 'a',
  B,
  C = 5,
  D,
  E = 1 << 2,
  F,
  'quoted-name' = 7,
  G = -3,
  H,
}

// enum Fake { X }
const text = 'enum Ghost { Y }';

export enum Status {
  /** The record is a draft. */
  Draft = 1,
  Submitted = 2, // sent to the manager
  Approved = 3,
  Rejected = 4,
  Archived = 5,
}

export enum LeaveType {
  Annual = 'annual',
  Sick = 'sick',
}
