'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // await queryInterface.dropTable('users');
    await queryInterface.createTable(
      'orders',
      {
        id: { type: Sequelize.INTEGER, primaryKey: true },
      },
    );
    await queryInterface.addIndex('orders', ['id']);
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('orders');
  },
};
