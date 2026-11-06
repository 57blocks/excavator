'use strict';

const tableName = process.env.EXTRA_TABLE;

module.exports = {
  async up(queryInterface) {
    await queryInterface.createTable(tableName, {});
    await queryInterface.addIndex(tableName, ['id']);
    await queryInterface.createTable('prefix_' + tableName, {});
    await queryInterface.createTable(`dyn_${tableName}`, {});
  },
  async down() {},
};
