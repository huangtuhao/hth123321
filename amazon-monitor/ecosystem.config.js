module.exports = {
  apps: [{
    name: 'amazon-monitor',
    script: 'server.js',
    watch: false,
    restart_delay: 5000,
    env: { NODE_ENV: 'production', PORT: 3000 },
  }],
};