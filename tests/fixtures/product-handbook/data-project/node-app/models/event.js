'use strict';

module.exports = (sequelize, DataTypes) => {
  return sequelize.define('Event', {}, {
    tableName: "model_only_events",
  });
};
