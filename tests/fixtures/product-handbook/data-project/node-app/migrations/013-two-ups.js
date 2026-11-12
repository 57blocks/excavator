'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.createTable('also_not_replayed', {});
  },
  up: async () => {},
  async down() {},
};
