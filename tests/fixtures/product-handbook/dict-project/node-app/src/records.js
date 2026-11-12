const ErrorStatus = {
  ok: { code: 0, message: 'Fine' },
  bad: { value: 'bad', label: 'Broken', code: 7 },
  odd: { id: 3, description: 'Odd one', name: 'Odd' },
  gone: { note: 1 },
  // the unused one
  unused: { code: 9 }, // trailing
  plain: 'plain',
};

const TaskStatus = {
  open: {
    code: 1,
    message: 'Open task',
  },
  later: { code: BASE + 1, value: 4 },
};
