'use strict';

module.exports = (sequelize, DataTypes) => {
  return sequelize.define('LegacyNote', {}, {
    tableName: 'legacy_notes',
  });
};
