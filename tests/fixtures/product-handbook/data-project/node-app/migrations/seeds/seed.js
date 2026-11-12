module.exports = {
  async up(queryInterface) {
    await queryInterface.bulkInsert('users', [{ id: 1 }]);
  },
};
