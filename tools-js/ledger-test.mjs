// 장부 칸 계산·머클 증명 검증이 실제 세폴리아 데이터와 맞는지 점검한다 (읽기 전용).
//   node tools-js/ledger-test.mjs
// 대상: 세폴리아 WETH9 (balanceOf 가 3번 칸에 있는 표준 컨트랙트)
import { ethers } from 'ethers';

globalThis.ethers = ethers;
const V = await import('../web/js/core/verify.js');
const RPC = 'https://ethereum-sepolia-rpc.publicnode.com';
const WETH = '0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9';
const BALANCE_SLOT = 3n;
const p = new ethers.JsonRpcProvider(RPC);
let fails = 0;
const check = (ok, msg) => { console.log(ok ? '  ✔' : '  ✘', msg); if (!ok) fails++; };

// 최근 Transfer 로그에서 보유자 하나를 고른다
const head = await p.getBlockNumber();
const logs = await p.getLogs({ address: WETH, topics: [ethers.id('Transfer(address,address,uint256)')], fromBlock: head - 2000, toBlock: head });
const holder = ethers.getAddress('0x' + logs.at(-1).topics[2].slice(26));
console.log(`보유자 ${holder}`);

const weth = new ethers.Contract(WETH, ['function balanceOf(address) view returns (uint256)'], p);
const slot = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['address', 'uint256'], [holder, BALANCE_SLOT]));
const block = await p.send('eth_getBlockByNumber', ['latest', false]);
const [bal, raw, proof] = await Promise.all([
  weth.balanceOf(holder, { blockTag: block.number }),
  p.send('eth_getStorageAt', [WETH, slot, block.number]),
  p.send('eth_getProof', [WETH, [slot], block.number]),
]);
check(BigInt(raw) === bal, `칸 keccak256(주소‖3) 의 값 ${BigInt(raw)} == balanceOf() ${bal}`);
const acc = V.verifyAccountProof(block.stateRoot, WETH, proof);
check(acc.ok, `WETH 계정 증명 (stateRoot → ${acc.steps.length}단계): ${acc.reason}`);
const st = V.verifyStorageProof(proof.storageHash, proof.storageProof[0]);
check(st.ok && st.value === bal, `저장공간 칸 증명 (storageHash → ${st.steps.length}단계): ${st.reason}, 값 ${st.value}`);

// 값이 0인(비어 있는) 칸의 '없음 증명'
const empty = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['address', 'uint256'], [ethers.Wallet.createRandom().address, BALANCE_SLOT]));
const p2 = await p.send('eth_getProof', [WETH, [empty], block.number]);
const st2 = V.verifyStorageProof(p2.storageHash, p2.storageProof[0]);
check(st2.ok && st2.value === 0n, `빈 칸 증명: ${st2.reason}`);

// 사람 지갑(EOA) 계정 증명
const p3 = await p.send('eth_getProof', [holder, [], block.number]);
const acc3 = V.verifyAccountProof(block.stateRoot, holder, p3);
check(acc3.ok, `보유자 계정 증명: ${acc3.reason}, codeHash ${p3.codeHash.slice(0, 10)}…, storageHash ${p3.storageHash.slice(0, 10)}…`);

// 과거 시점 조회 가능 범위
for (const back of [1, 50, 120]) {
  try { await p.send('eth_getStorageAt', [WETH, slot, ethers.toQuantity(Number(block.number) - back)]); check(true, `${back}블록 전 칸 조회 가능`); }
  catch { console.log(`  · ${back}블록 전 칸 조회 불가 (공개 노드가 과거 상태를 지움)`); }
}
console.log(fails ? `\n실패 ${fails}건` : '\n장부 칸 검증 통과 ✅');
process.exit(fails ? 1 : 0);
