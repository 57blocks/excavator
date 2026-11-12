'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.createTable('order_items', {});
  },
  async down() {},
};
