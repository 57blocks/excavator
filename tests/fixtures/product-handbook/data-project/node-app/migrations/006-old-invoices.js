'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.createTable("old_invoices", {});
  },
  async down() {},
};
