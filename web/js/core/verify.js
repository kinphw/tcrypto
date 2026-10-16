// "노드를 믿지 말고 검증하라" — 노드가 준 데이터를 브라우저에서 직접 재계산해 확인하는 함수 모음.
// 브라우저에서는 vendor/ethers.umd.min.js 가 전역 ethers 를, Node 검증 스크립트에서는 globalThis.ethers 를 쓴다.
const E = () => globalThis.ethers;

const q = (v) => (v === undefined || v === null ? '0x' : E().toBeArray(BigInt(v)).length === 0 ? '0x' : E().hexlify(E().toBeArray(BigInt(v))));
const bytesLen = (hex) => (hex.length - 2) / 2;

// ───────────────────────── QBFT extraData ─────────────────────────
// extraData = RLP([vanity(32B), [검증자 주소...], 투표([] 또는 [주소, 0xFF추가/0x00제거]), 라운드, [커밋 서명...]])
export function decodeQbftExtra(extraData) {
  const d = E().decodeRlp(extraData);
  const vote = Array.isArray(d[2]) && d[2].length === 2 ? { address: E().getAddress(d[2][0]), add: d[2][1] === '0xff' } : null;
  return {
    vanity: d[0],
    validators: d[1].map((a) => E().getAddress(a)),
    vote,
    round: d[3] === '0x' ? 0 : Number(BigInt(d[3])),
    seals: d[4],
    raw: d,
  };
}

function encodeQbftExtra(x, { round, seals }) {
  return E().encodeRlp([x.raw[0], x.raw[1], x.raw[2], q(round), seals]);
}

// ───────────────────────── 블록 헤더 ─────────────────────────
export const HEADER_FIELDS = [
  ['parentHash', 'hash'], ['sha3Uncles', 'hash'], ['miner', 'addr'], ['stateRoot', 'hash'],
  ['transactionsRoot', 'hash'], ['receiptsRoot', 'hash'], ['logsBloom', 'bytes'], ['difficulty', 'int'],
  ['number', 'int'], ['gasLimit', 'int'], ['gasUsed', 'int'], ['timestamp', 'int'], ['extraData', 'bytes'],
  ['mixHash', 'hash'], ['nonce', 'bytes'], ['baseFeePerGas', 'int'], ['withdrawalsRoot', 'hash'],
  ['blobGasUsed', 'int'], ['excessBlobGas', 'int'], ['parentBeaconBlockRoot', 'hash'], ['requestsHash', 'hash'],
  ['blockAccessListHash', 'hash'], ['slotNumber', 'int'],
];

export function encodeHeader(block, extraDataOverride) {
  const items = [];
  for (const [k, t] of HEADER_FIELDS) {
    if (block[k] === undefined || block[k] === null) continue; // 하드포크 이전 필드는 없음
    const v = k === 'extraData' && extraDataOverride ? extraDataOverride : block[k];
    items.push(t === 'int' ? q(v) : v);
  }
  return E().encodeRlp(items);
}

/**
 * 블록 해시 = keccak256( RLP(헤더 필드들) ).
 * 이더리움(세폴리아·메인넷)은 헤더 그대로, QBFT(사설망)는 extraData 에서 서명·라운드를 뺀 뒤 계산한다.
 */
export function verifyBlockHash(block) {
  const headerRlp = encodeHeader(block);
  const computed = E().keccak256(headerRlp);
  if (computed === block.hash) return { computed, ok: true, headerRlp, rule: 'ethereum' };
  try {
    const x = decodeQbftExtra(block.extraData);
    const qRlp = encodeHeader(block, encodeQbftExtra(x, { round: 0, seals: [] }));
    const q = E().keccak256(qRlp);
    if (q === block.hash) return { computed: q, ok: true, headerRlp: qRlp, rule: 'qbft' };
  } catch {}
  return { computed, ok: false, headerRlp, rule: 'ethereum' };
}

/** 커밋 서명(seal)마다 서명자 주소를 복원해 검증자 명단과 대조 */
export function verifySeals(block, validatorsOverride) {
  const x = decodeQbftExtra(block.extraData);
  const digest = E().keccak256(encodeHeader(block, encodeQbftExtra(x, { round: x.round, seals: [] })));
  const validators = validatorsOverride || x.validators;
  const signers = x.seals.map((sig) => {
    const b = E().getBytes(sig);
    const s = E().Signature.from({ r: E().hexlify(b.slice(0, 32)), s: E().hexlify(b.slice(32, 64)), yParity: b[64] % 2 });
    const addr = E().recoverAddress(digest, s);
    return { signature: sig, signer: addr, isValidator: validators.includes(addr) };
  });
  const needed = Math.ceil((2 * validators.length) / 3);
  const validCount = new Set(signers.filter((s) => s.isValidator).map((s) => s.signer)).size;
  return { digest, signers, needed, validCount, ok: validCount >= needed, round: x.round };
}

// ───────────────────────── 거래 ─────────────────────────
/** RPC 거래 JSON → 서명 포함 직렬화 바이트, 서명 대상 해시, 서명자 복원 */
export function verifyTransaction(rpcTx) {
  const type = Number(rpcTx.type);
  const sig = E().Signature.from({
    r: rpcTx.r,
    s: rpcTx.s,
    ...(type === 0 ? { v: BigInt(rpcTx.v) } : { yParity: Number(rpcTx.yParity ?? rpcTx.v) }),
  });
  if (type > 2) return { unsupported: true, type };
  const t = E().Transaction.from({
    type,
    chainId: rpcTx.chainId ? BigInt(rpcTx.chainId) : undefined,
    nonce: Number(rpcTx.nonce),
    gasLimit: BigInt(rpcTx.gas),
    gasPrice: type < 2 ? BigInt(rpcTx.gasPrice) : undefined,
    maxFeePerGas: type >= 2 ? BigInt(rpcTx.maxFeePerGas) : undefined,
    maxPriorityFeePerGas: type >= 2 ? BigInt(rpcTx.maxPriorityFeePerGas) : undefined,
    to: rpcTx.to || null,
    value: BigInt(rpcTx.value),
    data: rpcTx.input,
    accessList: type >= 1 ? rpcTx.accessList || [] : undefined,
    signature: sig,
  });
  const serialized = t.serialized;
  const hash = E().keccak256(serialized);
  return {
    serialized,
    size: bytesLen(serialized),
    unsignedSerialized: t.unsignedSerialized,
    signingHash: t.unsignedHash,
    recoveredFrom: t.from,
    hash,
    hashOk: hash === rpcTx.hash,
    fromOk: t.from.toLowerCase() === rpcTx.from.toLowerCase(),
    signature: { r: sig.r, s: sig.s, yParity: sig.yParity, v: sig.v },
  };
}

// ───────────────────────── 머클 패트리샤 트라이 ─────────────────────────
const toNibbles = (hex) => {
  const b = E().getBytes(hex);
  const n = [];
  for (const x of b) n.push(x >> 4, x & 15);
  return n;
};

function hexPrefix(nibbles, leaf) {
  const odd = nibbles.length % 2;
  const flag = (leaf ? 2 : 0) + odd;
  const arr = odd ? [flag, ...nibbles] : [flag, 0, ...nibbles];
  const out = new Uint8Array(arr.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = (arr[2 * i] << 4) | arr[2 * i + 1];
  return E().hexlify(out);
}

function nodeRef(node) {
  const enc = E().encodeRlp(node);
  return bytesLen(enc) < 32 ? node : E().keccak256(enc);
}

function buildNode(items, depth) {
  if (items.length === 1) return [hexPrefix(items[0].k.slice(depth), true), items[0].v];
  let cp = 0;
  for (;;) {
    const n = items[0].k[depth + cp];
    if (n === undefined || !items.every((it) => it.k[depth + cp] === n)) break;
    cp++;
  }
  if (cp > 0) return [hexPrefix(items[0].k.slice(depth, depth + cp), false), nodeRef(buildNode(items, depth + cp))];
  const branch = new Array(17).fill('0x');
  const buckets = Array.from({ length: 16 }, () => []);
  for (const it of items) {
    if (it.k.length === depth) branch[16] = it.v;
    else buckets[it.k[depth]].push(it);
  }
  buckets.forEach((b, i) => { if (b.length) branch[i] = nodeRef(buildNode(b, depth + 1)); });
  return branch;
}

const EMPTY_TRIE = '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421';

/** 순서 있는 목록(거래·영수증)을 '인덱스 → 값' 트라이로 만들어 루트 해시 계산 */
export function orderedTrieRoot(values) {
  if (!values.length) return EMPTY_TRIE;
  const items = values.map((v, i) => ({ k: toNibbles(E().encodeRlp(q(i))), v }));
  return E().keccak256(E().encodeRlp(buildNode(items, 0)));
}

export function encodeReceipt(r) {
  const payload = E().encodeRlp([
    Number(r.status) === 1 ? '0x01' : '0x',
    q(r.cumulativeGasUsed),
    r.logsBloom,
    r.logs.map((l) => [l.address, l.topics, l.data]),
  ]);
  const type = Number(r.type || 0);
  return type === 0 ? payload : E().concat([E().toBeHex(type, 1), payload]);
}

/** 블록의 거래 목록·영수증 목록으로 transactionsRoot / receiptsRoot 를 재계산 */
export function verifyRoots(block, rpcTxs, receipts) {
  const txRoot = orderedTrieRoot(rpcTxs.map((t) => verifyTransaction(t).serialized));
  const out = { transactionsRoot: { computed: txRoot, ok: txRoot === block.transactionsRoot } };
  if (receipts) {
    const rRoot = orderedTrieRoot(receipts.map(encodeReceipt));
    out.receiptsRoot = { computed: rRoot, ok: rRoot === block.receiptsRoot };
  }
  return out;
}

// ───────────────────────── 계정 상태 증명 (eth_getProof) ─────────────────────────
/**
 * stateRoot 하나만 믿고, 노드가 준 증명 경로를 따라 내려가 계정 값(nonce, 잔액, storageHash, codeHash)을 확인.
 * 경라이트 클라이언트가 전체 장부 없이 잔액을 검증하는 원리.
 */
export function verifyAccountProof(stateRoot, address, proof) {
  const path = toNibbles(E().keccak256(address));
  let expected = stateRoot;
  let depth = 0;
  const steps = [];
  for (let i = 0; i < proof.accountProof.length; i++) {
    const nodeRlp = proof.accountProof[i];
    const h = E().keccak256(nodeRlp);
    const hashOk = h === expected;
    const node = E().decodeRlp(nodeRlp);
    const kind = node.length === 17 ? 'branch' : (E().getBytes(node[0])[0] >> 4) >= 2 ? 'leaf' : 'extension';
    steps.push({ index: i, kind, hash: h, hashOk, bytes: bytesLen(nodeRlp) });
    if (!hashOk) return { ok: false, steps, reason: `${i}번째 노드 해시가 상위 노드가 가리키는 값과 다름` };
    if (kind === 'branch') {
      expected = node[path[depth]];
      depth++;
      if (expected === '0x') return { ok: false, steps, reason: '경로가 비어 있음 (계정 없음)' };
      continue;
    }
    const nb = toNibbles(node[0]);
    const flag = nb[0];
    const part = flag % 2 ? nb.slice(1) : nb.slice(2);
    const match = part.every((n, j) => path[depth + j] === n);
    if (!match) return { ok: false, steps, reason: '경로 불일치 (계정 없음 증명)' };
    depth += part.length;
    if (kind === 'leaf') {
      const [nonce, balance, storageHash, codeHash] = E().decodeRlp(node[1]);
      const val = {
        nonce: nonce === '0x' ? 0n : BigInt(nonce),
        balance: balance === '0x' ? 0n : BigInt(balance),
        storageHash,
        codeHash,
      };
      const ok =
        val.balance === BigInt(proof.balance) &&
        val.nonce === BigInt(proof.nonce) &&
        val.storageHash === proof.storageHash &&
        val.codeHash === proof.codeHash;
      return { ok, steps, value: val, reason: ok ? '증명 성공' : '리프 값이 노드가 주장한 값과 다름' };
    }
    expected = node[1];
  }
  return { ok: false, steps, reason: '증명이 리프에 도달하지 못함' };
}

// ───────────────────────── 배포 코드 검증 ─────────────────────────
/** 체인에 있는 런타임 코드가 소스 컴파일 결과와 같은지 (immutable 값 자리는 가리고 비교) */
export function verifyRuntimeCode(onchainHex, artifact) {
  const chain = E().getBytes(onchainHex);
  const local = E().getBytes(artifact.deployedBytecode);
  if (chain.length !== local.length) return { ok: false, reason: `길이 다름 (체인 ${chain.length} / 소스 ${local.length} bytes)` };
  const mask = new Uint8Array(chain.length);
  for (const refs of Object.values(artifact.immutableReferences || {}))
    for (const { start, length } of refs) mask.fill(1, start, start + length);
  for (let i = 0; i < chain.length; i++) {
    if (!mask[i] && chain[i] !== local[i]) return { ok: false, reason: `${i}번째 바이트부터 다름` };
  }
  const masked = mask.reduce((a, b) => a + b, 0);
  return { ok: true, reason: masked ? `일치 (immutable 값 ${masked} bytes 제외)` : '완전 일치' };
}
