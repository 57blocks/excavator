'use strict';

module.exports = (sequelize) => {
  return sequelize.define('Dynamic', {}, {
    tableName: computeName(),
  });
};
