// 운영 서버 준비 도구
//   node server/setup.mjs key            운영 지갑(열쇠) 만들기 — 이미 있으면 주소만 보여 줌
//   node server/setup.mjs password       관리 페이지 비밀번호 정하기 (화면에 안 보이게 입력)
//   node server/setup.mjs deploy-games   내기판·쿠폰 시장 배포 (운영 지갑이 ETH 로 수수료를 냄, 내기판 관리자 = 운영 지갑)
//                                        → app-config.json 에 주소 기록
//   node server/setup.mjs local <hardhat 개인키>   로컬 시험망에 전부 새로 배포하고 권한까지 맞춤 (시험용)
//        이때는 --config web/app-config.local.json --secrets server/.secrets-local --data server/data-local 을 함께 준다
import fs from 'node:fs';
import readline from 'node:readline';
import { ethers } from 'ethers';
import { CONFIG_FILE, readSecret, writeSecret, secretPath } from './lib/config.mjs';

const cmd = process.argv[2];

function ensureKey() {
  let pk = readSecret('operator.key');
  if (!pk) {
    pk = ethers.Wallet.createRandom().privateKey;
    writeSecret('operator.key', pk);
    console.log(`운영 열쇠를 만들었습니다: ${secretPath('operator.key')}`);
  }
  return new ethers.Wallet(pk);
}

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); };
    rl.question(question, (a) => { rl.close(); process.stdout.write('\n'); resolve(a); });
  });
}

const saveConfig = (patch) => {
  const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  Object.assign(cfg, patch, { contracts: { ...cfg.contracts, ...(patch.contracts || {}) } });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2) + '\n');
  return cfg;
};

if (cmd === 'key') {
  const w = ensureKey();
  console.log(`운영 지갑 주소: ${w.address}`);
} else if (cmd === 'password') {
  const pw = await askHidden('관리 페이지 비밀번호 (12자 이상): ');
  if (pw.length < 12) { console.error('12자 이상으로 정해 주세요'); process.exit(1); }
  const again = await askHidden('한 번 더: ');
  if (pw !== again) { console.error('두 번 입력한 비밀번호가 다릅니다'); process.exit(1); }
  const { hashPassword } = await import('./lib/admin.mjs');
  writeSecret('admin.pass', hashPassword(pw));
  console.log('비밀번호를 저장했습니다. 서버를 다시 시작할 필요는 없습니다.');
  process.exit(0);
} else if (cmd === 'deploy-games') {
  const w = ensureKey();
  const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  if (cfg.contracts.Bets) { console.log('이미 배포돼 있습니다:', cfg.contracts.Bets, cfg.contracts.Coupons); process.exit(0); }
  const p = new ethers.JsonRpcProvider(cfg.network.rpc, cfg.network.chainId, { staticNetwork: true, cacheTimeout: -1 });
  const signer = w.connect(p);
  console.log(`운영 지갑 ${w.address} ETH ${ethers.formatEther(await p.getBalance(w.address))}`);
  const { deployGames } = await import('../tools-js/deploy-lib.mjs');
  const block = await p.getBlockNumber();
  const out = await deployGames(signer, { Seogilwon: cfg.contracts.Seogilwon, Forwarder: cfg.contracts.Forwarder, admin: w.address });
  saveConfig({ contracts: out, gamesDeployBlock: block });
  console.log(`app-config 에 기록했습니다 (${CONFIG_FILE})`);
} else if (cmd === 'local') {
  const pk = process.argv[3];
  if (!pk) { console.error('사용법: node server/setup.mjs local <hardhat 개인키> --config web/app-config.local.json --secrets server/.secrets-local --data server/data-local'); process.exit(1); }
  const op = ensureKey();
  const p = new ethers.JsonRpcProvider('http://127.0.0.1:8545', undefined, { cacheTimeout: -1 });
  const issuer = new ethers.Wallet(pk, p);
  const { deployAll, deployGames, art } = await import('../tools-js/deploy-lib.mjs');
  const C = await deployAll(issuer);
  Object.assign(C, await deployGames(issuer, { ...C, admin: op.address }));
  const t = new ethers.Contract(C.Seogilwon, art('SeogilwonV1').abi, issuer);
  await (await t.configureMinter(op.address, 10_000_000)).wait();
  await (await t.updatePauser(op.address)).wait();
  await (await t.updateBlacklister(op.address)).wait();
  await (await issuer.sendTransaction({ to: op.address, value: ethers.parseEther('10') })).wait();
  await (await t.mint(issuer.address, 50000, '기존 발행분 (시험)')).wait();
  const net = await p.getNetwork();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({
    appName: '청라더헤븐', network: { chainId: Number(net.chainId), name: 'Local', rpc: 'http://127.0.0.1:8545', explorer: '', currency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, faucets: [] },
    issuer: issuer.address, contracts: C, deployBlock: 0,
  }, null, 2) + '\n');
  console.log(`로컬 배포 완료 → ${CONFIG_FILE}\n운영 지갑 ${op.address}: 발행 한도 1천만 · 정지 · 차단 · 내기판 관리자 · ETH 10`);
} else {
  console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 8).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
}
