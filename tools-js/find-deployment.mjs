// 발행자 주소만으로 청라더헤븐 컨트랙트 6개의 주소를 찾아 web/app-config.json 에 기록한다.
// 원리: 컨트랙트 주소 = keccak256(rlp(배포자 주소, 배포 당시 nonce)) 의 끝 20바이트 → nonce 를 차례로 대입해 계산하고,
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
// 산출물 이름 → 설정 파일의 키
const WANT = { Forwarder: 'Forwarder', SeogilwonV1: 'SeogilwonV1', SgwProxy: 'Seogilwon', Members: 'Members', Market: 'Market', CoinFactory: 'CoinFactory' };
const arts = Object.fromEntries(Object.keys(WANT).map((n) => [n, art(n)]));

const nonce = await p.getTransactionCount(issuer);
console.log(`발행자 ${issuer}, 지금까지 보낸 거래 ${nonce}건 — 컨트랙트 찾는 중…`);
const found = {};
for (let i = nonce - 1; i >= 0 && Object.keys(found).length < Object.keys(WANT).length; i--) {
  const addr = ethers.getCreateAddress({ from: issuer, nonce: i });
  const code = await p.getCode(addr);
  if (code === '0x') continue;
  for (const n of Object.keys(WANT)) {
    if (!found[WANT[n]] && verifyRuntimeCode(code, arts[n]).ok) { found[WANT[n]] = addr; console.log(`  ✔ ${WANT[n].padEnd(12)} ${addr} (nonce ${i})`); }
  }
}
const missing = Object.values(WANT).filter((k) => !found[k]);
if (missing.length) { console.error(`못 찾음: ${missing.join(', ')}`); process.exit(1); }

// 배포 블록: 공개 노드는 오래된 상태를 보관하지 않으므로, 프록시가 생성될 때 남긴 이벤트(Upgraded)를 최근 블록부터 거슬러 찾는다.
const head = await p.getBlockNumber();
let lo = null;
for (let to = head; to >= 0 && lo === null; to -= 50000) {
  const logs = await p.getLogs({ address: found.Seogilwon, fromBlock: Math.max(0, to - 49999), toBlock: to });
  if (logs.length) lo = Math.max(0, Math.min(...logs.map((l) => l.blockNumber)) - 50);
}
if (lo === null) { console.error('서길원 프록시의 배포 기록을 찾지 못했습니다'); process.exit(1); }
cfg.issuer = issuer;
cfg.contracts = found;
cfg.deployBlock = lo;
fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
console.log(`배포 블록 ${lo} → ${cfgPath} 갱신 완료`);
