'use strict';

module.exports = (sequelize, DataTypes) => {
  return sequelize.define('Gadget', {}, {
    tableName: 'old_gadgets',
  });
};
