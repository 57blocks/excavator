'use strict';

exports.up = async (queryInterface, Sequelize) => {
  await queryInterface.createTable('exports_up_t', {});
};

exports.down = async (queryInterface) => {
  await queryInterface.dropTable('exports_up_t');
};
