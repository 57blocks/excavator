'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.dropTable('cache_entries');
  },
  async down() {},
};
