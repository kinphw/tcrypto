// 발행자 주소만으로 실험실 컨트랙트 4개의 주소를 찾아 web/app-config.json 에 기록한다.
// 원리: 컨트랙트 주소 = keccak256(rlp(배포자 주소, 배포 당시 논스)) 의 끝 20바이트 → 논스를 0부터 차례로 대입해 계산하고,
//       그 주소의 코드가 우리 소스를 컴파일한 결과와 같은지 비교한다.
//   node tools-js/find-deployment.mjs <발행자주소> [설정파일=web/app-config.json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';

globalThis.ethers = ethers;
const { verifyRuntimeCode } = await import('../web/js/core/verify.js');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [issuerArg, cfgArg] = process.argv.slice(2);
const cfgPath = cfgArg || path.join(root, 'web', 'app-config.json');
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const issuer = ethers.getAddress(issuerArg);
const p = new ethers.JsonRpcProvider(cfg.network.rpc);
const art = (n) => JSON.parse(fs.readFileSync(path.join(root, 'web', 'contracts', `${n}.json`), 'utf8'));
const NAMES = ['Members', 'WonCoin', 'Market', 'CoinFactory'];
const arts = Object.fromEntries(NAMES.map((n) => [n, art(n)]));

const nonce = await p.getTransactionCount(issuer);
console.log(`발행자 ${issuer}, 지금까지 보낸 거래 ${nonce}건 — 컨트랙트 찾는 중…`);
const found = {};
for (let i = nonce - 1; i >= 0 && Object.keys(found).length < NAMES.length; i--) {
  const addr = ethers.getCreateAddress({ from: issuer, nonce: i });
  const code = await p.getCode(addr);
  if (code === '0x') continue;
  for (const n of NAMES) {
    if (!found[n] && verifyRuntimeCode(code, arts[n]).ok) { found[n] = { addr, nonce: i }; console.log(`  ✔ ${n.padEnd(12)} ${addr} (논스 ${i})`); }
  }
}
const missing = NAMES.filter((n) => !found[n]);
if (missing.length) { console.error(`못 찾음: ${missing.join(', ')}`); process.exit(1); }

// 배포 블록: 공개 노드는 오래된 상태를 보관하지 않으므로, 원화코인이 생성자에서 남긴 첫 이벤트(권한 부여)를 최근 블록부터 거슬러 찾는다.
// 명부(Members)는 그보다 한두 블록 먼저 배포되므로 여유를 두고 50블록 앞을 시작점으로 삼는다.
const head = await p.getBlockNumber();
let lo = null;
for (let to = head; to >= 0 && lo === null; to -= 50000) {
  const from = Math.max(0, to - 49999);
  const logs = await p.getLogs({ address: found.WonCoin.addr, fromBlock: from, toBlock: to });
  if (logs.length) lo = Math.max(0, Math.min(...logs.map((l) => l.blockNumber)) - 50);
}
if (lo === null) { console.error('원화코인의 배포 기록을 찾지 못했습니다'); process.exit(1); }
cfg.issuer = issuer;
cfg.contracts = Object.fromEntries(NAMES.map((n) => [n, found[n].addr]));
cfg.deployBlock = lo;
fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
console.log(`배포 블록 ${lo} → ${cfgPath} 갱신 완료`);
