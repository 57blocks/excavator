'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('ghost_table', 'x', Sequelize.STRING);
  },
  async down() {},
};
