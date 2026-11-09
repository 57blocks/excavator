import { QueryInterface } from 'sequelize';

export const up = async (queryInterface: QueryInterface) => {
  await queryInterface.createTable('esm_const_t', {});
};

export const down = async (queryInterface: QueryInterface) => {
  await queryInterface.dropTable('esm_const_t');
};
