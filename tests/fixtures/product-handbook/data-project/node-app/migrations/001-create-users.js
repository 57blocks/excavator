'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('users', {
      id: { type: Sequelize.INTEGER, primaryKey: true },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('users');
  },
};
