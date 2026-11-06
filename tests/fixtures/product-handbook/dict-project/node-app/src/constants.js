'use strict';

const UserStatus = {
  active: 1,
  // temporarily blocked
  blocked: 2,
  deleted: 3, // soft deleted
  /* not yet used */
  pending: 0,
  properties: {
    1: 'active',
    2: 'blocked',
    3: 'deleted',
  },
};

module.exports.INVOICE_STATE = { open: 'open', paid: 'paid', void: 'void' };

const Config = { retries: 3 };

let EmptyKind = { build() {} };

var OrderStage = {
  created: 'created',
  done: 'done',
  names: { created: 'Created', gone: 'Gone' },
};

// const CommentedStatus = { a: 1 };

module.exports = { UserStatus, Config };
