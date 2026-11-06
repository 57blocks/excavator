import { QueryInterface } from 'sequelize';

export async function up(queryInterface: QueryInterface) {
  await queryInterface.createTable('esm_fn_t', {});
}

export function down(queryInterface: QueryInterface) {
  return queryInterface.dropTable('esm_fn_t');
}
