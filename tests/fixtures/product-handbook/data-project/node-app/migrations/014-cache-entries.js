'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.createTable('cache_entries', {});
  },
  async down() {},
};
