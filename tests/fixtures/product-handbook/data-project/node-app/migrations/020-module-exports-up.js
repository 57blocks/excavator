'use strict';

module.exports.up = function (queryInterface) {
  return queryInterface.createTable('module_up_t', {});
};

module.exports.down = function (queryInterface) {
  return queryInterface.dropTable('module_up_t');
};
