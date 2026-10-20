// pm2 실행 설정: pm2 start ecosystem.config.cjs && pm2 save
// 서버는 127.0.0.1:4300 에서만 듣는다. 바깥은 Apache(tcrypto.kro.kr, apache_config/vhosts/tcrypto-https.conf)가 받아 넘긴다.
module.exports = {
  apps: [{
    name: 'tcrypto',
    script: 'server/main.mjs',
    cwd: __dirname,
    node_args: '--disable-warning=ExperimentalWarning',
    env: { NODE_ENV: 'production' },
    max_restarts: 20,
    restart_delay: 3000,
    time: true,
  }],
};
