'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.createTable('temp_logs', {});
  },
  async down(queryInterface) {
    await queryInterface.dropTable('temp_logs');
  },
};
