export default {
  async up(queryInterface: QueryInterface) {
    await queryInterface.createTable('ts_events', {});
  },
  async down(queryInterface: QueryInterface) {},
};
