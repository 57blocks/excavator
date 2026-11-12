'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.renameTable('old_invoices', 'invoices');
  },
  async down() {},
};
