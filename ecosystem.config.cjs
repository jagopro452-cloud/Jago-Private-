// Requires Redis adapter for Socket.IO — see server/index.ts
//
// name is 'jago-server' to match the process name deploy.yml has managed
// since the switch to a GitHub Actions push deploy (see that workflow's
// header comment) — pm2 startOrReload matches by this name, so it must
// match the already-running process for a graceful reload rather than
// starting a second, duplicate process alongside it.
//
// No node_args --env-file here: deploy.yml's restart step already does
// `source /home/ubuntu/jago-app/.env` into the shell before invoking pm2,
// so env vars are inherited normally. An explicit --env-file pointing at a
// path that doesn't exist on this host (an earlier revision pointed at
// /var/www/jago/.env, used only by the deprecated deploy-production.sh
// path) would make Node fail to start.
module.exports = {
  apps: [{
    name: 'jago-server',
    script: 'dist/index.js',
    instances: 'max',
    exec_mode: 'cluster',
    wait_ready: false,
    listen_timeout: 15000,
    // Must exceed server/index.ts's SHUTDOWN_TIMEOUT_MS (30000) — otherwise
    // PM2 SIGKILLs the process before its own graceful-drain timeout can
    // fire, turning every shutdown slower than 10s into a hard kill instead
    // of a clean HTTP/Socket.IO/DB drain.
    kill_timeout: 35000,
    env_production: {
      NODE_ENV: 'production',
      PORT: 5000,
    },
    max_memory_restart: '512M',
    restart_delay: 3000,
    max_restarts: 10,
    exp_backoff_restart_delay: 200,
    watch: false,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    error_file: '/var/log/jago/error.log',
    out_file: '/var/log/jago/out.log',
  }],
};
