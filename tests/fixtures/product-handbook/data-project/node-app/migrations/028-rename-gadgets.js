'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.renameTable('gadget_v0', 'old_gadgets');
    await queryInterface.renameTable('old_gadgets', 'new_gadgets');
  },
  async down() {},
};
