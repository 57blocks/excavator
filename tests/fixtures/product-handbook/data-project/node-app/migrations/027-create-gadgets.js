'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.createTable('gadget_v0', {});
  },
  async down() {},
};
