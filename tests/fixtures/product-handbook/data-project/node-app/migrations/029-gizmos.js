'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.createTable('old_gizmos', {});
    await queryInterface.renameTable('old_gizmos', 'new_gizmos');
  },
  async down() {},
};
