module.exports = {
  apps: [{
    name: "frame",
    script: 'index.js',
  }],
  autorestart: true,
  cron_restart: "0 0 * * *" // every day
};
