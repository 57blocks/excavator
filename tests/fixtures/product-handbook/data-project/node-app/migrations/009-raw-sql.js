'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query('CREATE TABLE IF NOT EXISTS audit_entries (id int)');
    await queryInterface.sequelize.query('ALTER TABLE audit_entries ADD COLUMN note text');
    await queryInterface.sequelize.query('ALTER TABLE audit_entries RENAME TO audit_log');
    await queryInterface.sequelize.query('CREATE UNIQUE INDEX idx_users_email ON users (email)');
    await queryInterface.sequelize.query("INSERT INTO users (id) VALUES (1)");
    await queryInterface.sequelize.query('UPDATE orders SET id = 1');
    await queryInterface.sequelize.query('DELETE FROM users WHERE id = 2');
    await queryInterface.sequelize.query('TRUNCATE TABLE users');
    await queryInterface.sequelize.query(`
      CREATE TABLE "public"."reports" (id int);
      CREATE TABLE tmp_a (id int);
      CREATE TABLE tmp_b (id int);
      DROP TABLE IF EXISTS tmp_a, tmp_b;
    `);
    await queryInterface.sequelize.query(`DROP TABLE ${tableName}`);
  },
  async down() {},
};
