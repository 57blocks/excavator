import { InvoiceState, Status } from './enums';

export const stateLabels: Record<InvoiceState, string> = {
  [InvoiceState.Open]: 'Open invoice',
  [InvoiceState.Paid]: "Paid in full",
  [InvoiceState['Void']]: 'Voided',
  [InvoiceState.Missing]: 'Not a member',
};

export const statusLabels = {
  [Status.Draft]: 'Draft',
  [Status.Approved]: 'Approved',
};

const guard = cond ? list[Status.Draft] : 'x';

// [Status.Rejected]: 'Rejected in a comment',
