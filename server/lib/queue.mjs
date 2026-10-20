// 거래 대기열: 서버가 블록체인에 올리는 모든 거래를 한 줄로 세워 보낸다.
//  - 같은 요청(같은 서명 지문 key)은 한 번만 들어간다 → 예전의 '같은 입금 신청 이중 발행' 같은 경쟁이 생길 수 없다
//  - nonce 는 서버가 직접 센다. 거래를 먼저 서명해 지문(해시)과 원문을 DB 에 적은 뒤 보내므로, 서버가 중간에 꺼져도 다시 켜면 이어서 확인·재전송한다
//  - 블록에 담기길 기다리지 않고 다음 거래를 보낸다(한 블록에 여러 건). 담기면 결과를 기록하고 후속 처리(hook)를 부른다
//  - 앞선 거래가 아직 안 담겨서 실패할 거래(예: 방금 충전한 돈으로 내기 걸기)는 잠깐 미뤘다가 다시 해 본다
import { ethers } from 'ethers';
import { db, now } from './db.mjs';
import { cfg, provider, operator, contracts } from './chain.mjs';

const MIN_TIP = 50_000_000n; // 0.05 gwei
const MAX_INFLIGHT = 16;
const DEFER_MAX = 40; // 앞선 거래를 기다리며 다시 해 보는 최대 횟수 (약 2분)
const BUMP_AFTER = 150; // 초. 이만큼 안 담기면 수수료를 올려 다시 보냄

const hooks = {};
/** kind 별 후속 처리: { done(job, receipt), failed(job, reason) } */
export const onJob = (kind, h) => { hooks[kind] = h; };

const json = (v) => JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? x.toString() : x));
const parse = (s, d = null) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
export const getJob = (id) => db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
export const jobView = (j) => j && ({ id: j.id, kind: j.kind, label: j.label, status: j.status, tx: j.tx, error: j.error, createdAt: j.created_at, doneAt: j.done_at });

/** 거래 하나를 대기열에 넣는다. key 가 같은 것이 이미 있으면 새로 넣지 않고 그것을 돌려준다 */
export function enqueue({ key = null, kind, addr = null, label, target, method, args, gas = null, meta = null }) {
  if (!contracts[target]) throw new Error(`알 수 없는 컨트랙트: ${target}`);
  if (key) {
    const ex = db.prepare('SELECT * FROM jobs WHERE key = ?').get(key);
    if (ex) return { job: ex, duplicate: true };
  }
  const r = db.prepare(`INSERT INTO jobs (key, kind, addr, label, target, method, args, gas, meta, status, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?)`)
    .run(key, kind, addr?.toLowerCase() ?? null, label, target, method, json(args), gas == null ? null : String(gas), meta == null ? null : json(meta), now());
  kick();
  return { job: getJob(r.lastInsertRowid), duplicate: false };
}

const setJob = (id, fields) => {
  const keys = Object.keys(fields);
  db.prepare(`UPDATE jobs SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => fields[k]), id);
};

export function reasonOf(e) {
  return e?.revert?.args?.[0] || e?.reason || e?.shortMessage || e?.info?.error?.message || e?.message || String(e);
}

async function feeHint(multiplier = 1n) {
  const [blk, tip] = await Promise.all([provider.getBlock('latest'), provider.send('eth_maxPriorityFeePerGas', []).then(BigInt).catch(() => 0n)]);
  const prio = (tip > MIN_TIP ? tip : MIN_TIP) * multiplier;
  return { maxPriorityFeePerGas: prio, maxFeePerGas: (blk?.baseFeePerGas ?? 0n) * 2n + prio };
}

let nonce = null;
const deferUntil = new Map();
const deferCount = new Map();

async function sendJob(j) {
  const c = contracts[j.target];
  const fn = c.getFunction(j.method);
  const args = parse(j.args, []);
  let gasLimit;
  try {
    const est = await fn.estimateGas(...args, { from: operator.address });
    gasLimit = (est * 13n) / 10n + 20000n;
    if (j.gas && BigInt(j.gas) > gasLimit) gasLimit = BigInt(j.gas);
  } catch (e) {
    const inflight = db.prepare("SELECT COUNT(*) n FROM jobs WHERE status = 'sent'").get().n;
    const tries = (deferCount.get(j.id) || 0) + 1;
    if (inflight > 0 && tries <= DEFER_MAX) { // 앞선 거래가 담긴 뒤에는 될 수도 있다
      deferCount.set(j.id, tries);
      deferUntil.set(j.id, Date.now() + 3000);
      return;
    }
    return finish(j, 'failed', null, reasonOf(e));
  }
  const fees = await feeHint();
  if (nonce == null) nonce = await provider.getTransactionCount(operator.address, 'pending');
  const populated = await fn.populateTransaction(...args);
  const signed = await operator.signTransaction({ ...populated, type: 2, chainId: cfg.network.chainId, nonce, gasLimit, ...fees });
  const hash = ethers.keccak256(signed);
  const meta = { ...parse(j.meta, {}), raw: signed, prev: [] };
  setJob(j.id, { status: 'sent', tx: hash, nonce, fee: fees.maxPriorityFeePerGas.toString(), sent_at: now(), tries: j.tries + 1, meta: json(meta) });
  nonce++;
  deferUntil.delete(j.id);
  try {
    await provider.broadcastTransaction(signed);
  } catch (e) {
    const msg = reasonOf(e);
    if (/already known|known transaction/i.test(msg)) return; // 이미 노드에 있음
    nonce = null; // 노드와 다시 맞춘다
    if (/nonce too low|nonce has already been used/i.test(msg)) {
      setJob(j.id, { status: 'queued', tx: null, nonce: null }); // 이 번호는 다른 거래가 썼다 → 새 번호로 다시
      return;
    }
    setJob(j.id, { status: 'queued', tx: null, nonce: null });
    deferUntil.set(j.id, Date.now() + 5000);
    console.warn(`[queue] #${j.id} 전송 실패, 다시 시도: ${msg}`);
  }
}

/** 담기지 않고 오래 머문 거래: 같은 번호로 수수료를 올려 다시 보낸다 */
async function bump(j) {
  const meta = parse(j.meta, {});
  const tx = ethers.Transaction.from(meta.raw);
  const fees = await feeHint(2n);
  const prio = BigInt(j.fee || 0) * 2n > fees.maxPriorityFeePerGas ? BigInt(j.fee) * 2n : fees.maxPriorityFeePerGas;
  const signed = await operator.signTransaction({
    type: 2, chainId: tx.chainId, nonce: tx.nonce, to: tx.to, data: tx.data, value: tx.value, gasLimit: tx.gasLimit,
    maxPriorityFeePerGas: prio, maxFeePerGas: fees.maxFeePerGas + prio,
  });
  const hash = ethers.keccak256(signed);
  setJob(j.id, { tx: hash, fee: prio.toString(), sent_at: now(), meta: json({ ...meta, raw: signed, prev: [...(meta.prev || []), j.tx] }) });
  await provider.broadcastTransaction(signed).catch((e) => console.warn(`[queue] #${j.id} 재전송 실패: ${reasonOf(e)}`));
}

async function finish(j, status, receipt, error = null) {
  setJob(j.id, { status, error, done_at: now(), ...(receipt ? { tx: receipt.hash } : {}) });
  deferCount.delete(j.id);
  const h = hooks[j.kind];
  const job = getJob(j.id);
  try {
    if (status === 'done') await h?.done?.(job, receipt);
    else await h?.failed?.(job, error);
  } catch (e) {
    console.error(`[queue] #${j.id} 후속 처리 오류:`, e);
  }
}

async function failReason(j, receipt) {
  try {
    const t = await provider.getTransaction(receipt.hash);
    await provider.call({ from: t.from, to: t.to, data: t.data, gasLimit: t.gasLimit, blockTag: receipt.blockNumber - 1 });
    return receipt.gasUsed === t.gasLimit ? '가스 부족' : '실행 중 거절';
  } catch (e) { return reasonOf(e); }
}

async function watch() {
  for (const j of db.prepare("SELECT * FROM jobs WHERE status = 'sent'").all()) {
    const meta = parse(j.meta, {});
    let receipt = null;
    for (const h of [j.tx, ...(meta.prev || [])]) {
      receipt = await provider.getTransactionReceipt(h).catch(() => null);
      if (receipt) break;
    }
    if (receipt) {
      await finish(j, receipt.status === 1 ? 'done' : 'failed', receipt, receipt.status === 1 ? null : await failReason(j, receipt));
      continue;
    }
    const age = now() - j.sent_at;
    if (age > 30 && !(await provider.getTransaction(j.tx).catch(() => null)) && meta.raw) {
      // 노드가 거래를 모름 (서버가 보내기 직전에 꺼졌거나 노드가 버림) → 원문을 다시 보낸다
      await provider.broadcastTransaction(meta.raw).catch(async (e) => {
        if (/nonce too low|nonce has already been used/i.test(reasonOf(e))) {
          const cnt = await provider.getTransactionCount(operator.address, 'latest');
          if (cnt > j.nonce) await finish(j, 'failed', null, '같은 번호의 다른 거래가 먼저 담김');
        }
      });
    } else if (age > BUMP_AFTER) {
      await bump(j).catch((e) => console.warn(`[queue] #${j.id} 수수료 올리기 실패: ${reasonOf(e)}`));
    }
  }
}

let busy = false;
let kicked = false;
async function tick() {
  if (!operator) return;
  if (busy) { kicked = true; return; }
  busy = true;
  try {
    do {
      kicked = false;
      await watch();
      const inflight = db.prepare("SELECT COUNT(*) n FROM jobs WHERE status = 'sent'").get().n;
      if (inflight >= MAX_INFLIGHT) break;
      const queued = db.prepare("SELECT * FROM jobs WHERE status = 'queued' ORDER BY id LIMIT ?").all(MAX_INFLIGHT - inflight);
      for (const j of queued) {
        if ((deferUntil.get(j.id) || 0) > Date.now()) continue;
        await sendJob(j).catch((e) => { nonce = null; console.error(`[queue] #${j.id}`, e); });
      }
    } while (kicked);
  } catch (e) {
    console.error('[queue]', e.message);
  } finally {
    busy = false;
  }
}

export function kick() { setImmediate(tick); }
export function startQueue() {
  if (!operator) { console.warn('[queue] 운영 열쇠가 없어 거래를 보내지 않습니다 (node server/setup.mjs)'); return; }
  setInterval(tick, 3000);
  kick();
}

export function queueStats() {
  const rows = db.prepare('SELECT status, COUNT(*) n FROM jobs GROUP BY status').all();
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}
