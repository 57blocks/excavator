'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('users', 'email', Sequelize.STRING);
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('users', 'email');
  },
};
