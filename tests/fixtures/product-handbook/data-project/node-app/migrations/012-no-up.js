'use strict';

module.exports = {
  async change(queryInterface) {
    await queryInterface.createTable('not_replayed', {});
  },
};
