// 장부의 '칸'을 직접 찾아가 읽는 도구.
// 이더리움 장부(상태) = 주소마다 [nonce, balance, storageHash, codeHash] 4칸.
// 컨트랙트는 여기에 더해 자기만의 저장공간(storage)이 있고, 토큰 잔액은 그 안의 칸에 적힌다.
import { rpc, artifact } from './chain.js';
import { verifyAccountProof, verifyStorageProof } from './verify.js';
import { identify } from './abi.js';

const E = () => globalThis.ethers;
export const EMPTY_CODE_HASH = '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470'; // keccak256(빈 코드)
export const EMPTY_STORAGE = '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421'; // 빈 트리의 루트

/** 컴파일 결과의 변수 배치표에서 변수가 몇 번 칸에 있는지 */
export function slotOf(art, label) {
  const s = art.storageLayout.storage.find((x) => x.label === label);
  if (!s) throw new Error(`${art.contractName} 에 ${label} 변수가 없습니다`);
  return BigInt(s.slot);
}

/** mapping(address => …) 의 칸 위치 = keccak256(키 32바이트 ‖ 칸 번호 32바이트) */
export function mappingSlot(key, slot) {
  return E().keccak256(E().AbiCoder.defaultAbiCoder().encode(['address', 'uint256'], [key, slot]));
}

/** mapping(address => mapping(address => …)) 예: allowance[owner][spender] */
export function nestedMappingSlot(k1, k2, slot) {
  const inner = mappingSlot(k1, slot);
  return E().keccak256(E().AbiCoder.defaultAbiCoder().encode(['address', 'bytes32'], [k2, inner]));
}

/** 계정 4칸 + (선택) 저장공간 칸들을 머클 증명과 함께 읽고, 이 브라우저에서 검증 */
export async function readAccount(address, storageKeys = [], blockTag = 'latest') {
  const block = await rpc('eth_getBlockByNumber', [blockTag, false]);
  const proof = await rpc('eth_getProof', [address, storageKeys, block.number]);
  const account = verifyAccountProof(block.stateRoot, address, proof);
  const storage = (proof.storageProof || []).map((sp) => ({ key: sp.key, value: BigInt(sp.value), check: verifyStorageProof(proof.storageHash, sp) }));
  return { block, proof, account, storage };
}

/** 토큰 컨트랙트 주소 → 산출물 (원화코인 또는 친구 코인만) */
async function tokenArtifact(address) {
  const name = await identify(address);
  return name === 'WonCoin' || name === 'FriendCoin' ? { name, art: await artifact(name) } : null;
}

/**
 * 거래 영수증의 이벤트를 보고, 이 거래가 건드린 장부 칸 목록을 만든다.
 *  - ETH: 보낸 사람(금액+수수료), 받는 곳(금액), 블록 생성자(팁)
 *  - 토큰: Transfer → balanceOf[보낸쪽], balanceOf[받는쪽] / Approval → allowance[주인][지출자]
 */
export async function cellsForTx(tx, receipt, block) {
  const cells = [];
  const seen = new Set();
  const add = (c) => { const k = `${c.kind}|${c.address}|${c.slot || ''}`; if (!seen.has(k)) { seen.add(k); cells.push(c); } };
  add({ kind: 'eth', address: E().getAddress(tx.from), role: '보낸 사람 (금액 + 수수료)' });
  if (tx.to && BigInt(tx.value) > 0n) add({ kind: 'eth', address: E().getAddress(tx.to), role: '받는 곳' });
  if (block?.miner) add({ kind: 'eth', address: E().getAddress(block.miner), role: '블록 생성자 (팁)' });
  const TRANSFER = E().id('Transfer(address,address,uint256)');
  const APPROVAL = E().id('Approval(address,address,uint256)');
  for (const log of receipt.logs) {
    if (log.topics[0] !== TRANSFER && log.topics[0] !== APPROVAL) continue;
    const t = await tokenArtifact(log.address);
    if (!t) continue;
    const a = (i) => E().getAddress('0x' + log.topics[i].slice(26));
    if (log.topics[0] === TRANSFER) {
      const base = slotOf(t.art, 'balanceOf');
      for (const holder of [a(1), a(2)]) {
        if (holder === E().ZeroAddress) continue;
        add({ kind: 'storage', address: E().getAddress(log.address), token: t.name, var: 'balanceOf', key: holder, slot: mappingSlot(holder, base), base });
      }
      // 다른 프로그램(예: 상점가)이 대신 꺼내 간 경우(transferFrom): 그 프로그램에 허락해 둔 한도 칸도 줄어든다
      if (tx.to && tx.to.toLowerCase() !== log.address.toLowerCase() && a(1) !== E().ZeroAddress) {
        const ab = slotOf(t.art, 'allowance');
        const spender = E().getAddress(tx.to);
        add({ kind: 'storage', address: E().getAddress(log.address), token: t.name, var: 'allowance', key: a(1), key2: spender, slot: nestedMappingSlot(a(1), spender, ab), base: ab });
      }
    } else {
      const base = slotOf(t.art, 'allowance');
      add({ kind: 'storage', address: E().getAddress(log.address), token: t.name, var: 'allowance', key: a(1), key2: a(2), slot: nestedMappingSlot(a(1), a(2), base), base });
    }
  }
  return cells;
}

/** 칸 하나의 값을 특정 블록 시점으로 읽는다. 공개 노드가 과거 상태를 지웠으면 null */
export async function readCell(cell, blockNumber) {
  const tag = E().toQuantity(blockNumber);
  try {
    if (cell.kind === 'eth') return BigInt(await rpc('eth_getBalance', [cell.address, tag]));
    return BigInt(await rpc('eth_getStorageAt', [cell.address, cell.slot, tag]));
  } catch {
    return null;
  }
}
