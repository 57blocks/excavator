'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.dropTable('legacy_notes');
  },
  async down() {},
};
