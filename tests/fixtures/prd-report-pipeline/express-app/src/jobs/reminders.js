const schedule = require('node-schedule');

function startReminders(send) {
  return schedule.scheduleJob('0 9 * * *', () => send('daily reminder'));
}

module.exports = { startReminders };
