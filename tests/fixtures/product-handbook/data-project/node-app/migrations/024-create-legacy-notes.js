'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.createTable('legacy_notes', {});
  },
  async down() {},
};
