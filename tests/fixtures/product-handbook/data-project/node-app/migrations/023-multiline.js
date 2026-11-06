'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.createTable(
      'multi_old',
      {},
    );
    await queryInterface.renameTable(
      'multi_old',
      'multi_new',
    );
    await queryInterface.renameTable('multi_new', 'multi_last');
    await queryInterface.sequelize.query(`
      CREATE TABLE
        split_sql (id int);
      ALTER TABLE
        split_sql
        RENAME TO split_final;
      DROP TABLE IF EXISTS
        tmp_c,
        tmp_d;
    `);
  },
  async down() {},
};
