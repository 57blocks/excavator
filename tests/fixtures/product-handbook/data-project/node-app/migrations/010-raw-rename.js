'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query('CREATE TABLE staging_x (id int)');
    await queryInterface.sequelize.query('CREATE TABLE staging_p (id int)');
    await queryInterface.sequelize.query('RENAME TABLE `staging_x` TO `staging_y`, staging_p TO staging_q');
  },
  async down() {},
};
