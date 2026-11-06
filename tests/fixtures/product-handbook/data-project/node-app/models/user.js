'use strict';
// tableName: 'comment_only_table'
module.exports = (sequelize, DataTypes) => {
  return sequelize.define('User', { id: DataTypes.INTEGER }, {
    tableName: 'users',
  });
};
