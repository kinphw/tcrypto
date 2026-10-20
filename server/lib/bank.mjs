// 가상 원화 은행 — 진짜 은행처럼 블록체인 밖(서버 장부)에 있다. 현금은 오가지 않는다.
//  계좌: 참여자 통장(지갑 주소) · reserve(발행사 준비금 계좌) · treasury(놀이 돈이 생겨나는 곳, 음수 허용)
//  충전 = 통장 → 준비금 이체 후 그만큼 서길원 발행        (실제: 은행 입금 → 발행사 확인 → 발행)
//  환매 = 서길원을 발행사(운영 지갑)로 보내면 소각 후 준비금 → 통장 (실제: 상환 신청 → 소각 → 은행 송금)
//  그래서 언제나  준비금 = 총발행량 − 소각 대기분(운영 지갑이 들고 있는 서길원)
import { db, now, today, tx, kvGet, kvSet, settings } from './db.mjs';
import { cfg, contracts, operator, addrEq } from './chain.mjs';
import { enqueue, onJob } from './queue.mjs';
import { verifyRelay, big } from '../../web/js/core/relaykit.js';
import { splitSig } from '../../web/js/core/sigs.js';

export const RESERVE = 'reserve';
export const TREASURY = 'treasury';
const acct = (a) => (a === RESERVE || a === TREASURY ? a : a.toLowerCase());

export const balance = (a) => db.prepare('SELECT balance FROM bank_accounts WHERE id = ?').get(acct(a))?.balance ?? 0;

/** 계좌 이체 (복식: 한쪽에서 빼고 한쪽에 더함). ref 가 같은 이체는 한 번만 일어난다 → 이미 있으면 그 기록을 돌려줌 */
export function transfer(from, to, amount, kind, memo, ref) {
  from = acct(from); to = acct(to);
  amount = Math.floor(Number(amount));
  if (!(amount > 0)) throw new Error('금액은 1원 이상이어야 합니다');
  return tx(() => {
    if (ref) {
      const ex = db.prepare('SELECT * FROM bank_tx WHERE ref = ?').get(ref);
      if (ex) return ex;
    }
    if (from !== TREASURY && balance(from) < amount) throw new Error('통장 잔액이 부족합니다');
    const up = db.prepare('INSERT INTO bank_accounts(id, balance) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET balance = balance + excluded.balance');
    up.run(from, -amount);
    up.run(to, amount);
    const r = db.prepare('INSERT INTO bank_tx(at, from_acct, to_acct, amount, kind, memo, ref) VALUES (?, ?, ?, ?, ?, ?, ?)').run(now(), from, to, amount, kind, memo, ref);
    return db.prepare('SELECT * FROM bank_tx WHERE id = ?').get(r.lastInsertRowid);
  });
}

export function history(addr, limit = 30) {
  const a = acct(addr);
  return db.prepare('SELECT * FROM bank_tx WHERE from_acct = ? OR to_acct = ? ORDER BY id DESC LIMIT ?').all(a, a, limit)
    .map((t) => ({ id: t.id, at: t.at, kind: t.kind, memo: t.memo, amount: t.to_acct === a ? t.amount : -t.amount }));
}

const startOfToday = () => Math.floor(Date.parse(`${today()}T00:00:00+09:00`) / 1000);
const chargedToday = (addr) => db.prepare("SELECT COALESCE(SUM(amount), 0) s FROM bank_tx WHERE from_acct = ? AND kind = 'charge' AND at >= ?").get(acct(addr), startOfToday()).s
  - db.prepare("SELECT COALESCE(SUM(amount), 0) s FROM bank_tx WHERE to_acct = ? AND kind = 'charge-refund' AND at >= ?").get(acct(addr), startOfToday()).s;

const isUser = (addr) => !!db.prepare('SELECT 1 FROM users WHERE addr = ?').get(addr.toLowerCase());

/** 충전: 서명된 입금 신청서(DepositNotice)로 통장 → 준비금, 그리고 같은 금액 발행 */
export function charge(obj) {
  if (obj?.k !== 'notice') throw new Error('충전 신청서가 아닙니다');
  const v = verifyRelay(obj, cfg);
  if (!v.ok) throw new Error('서명이 맞지 않습니다');
  const addr = obj.notice.account;
  if (!isUser(addr)) throw new Error('먼저 가입해 주세요');
  const amount = Number(obj.notice.amount);
  if (!Number.isInteger(amount) || amount < 1) throw new Error('금액은 1원 이상 정수');
  if (Math.abs(now() - Number(obj.notice.issuedAt)) > 86400) throw new Error('오래된 신청서입니다');
  if (balance(addr) < amount) throw new Error('통장 잔액이 부족합니다');
  const cap = settings().maxChargePerDay;
  if (chargedToday(addr) + amount > cap) throw new Error(`하루 충전 한도(${cap.toLocaleString()}원)를 넘습니다`);
  const done = db.prepare('SELECT * FROM jobs WHERE key = ?').get(`mint:${v.digest}`);
  if (done) return { job: done, duplicate: true };
  const t = transfer(addr, RESERVE, amount, 'charge', '서길원 충전', `charge:${v.digest}`);
  return enqueue({
    key: `mint:${v.digest}`, kind: 'mint', addr, label: `충전 ${amount.toLocaleString()}원 → ${amount.toLocaleString()} sgw`,
    target: 'Seogilwon', method: 'mint', args: [addr, amount, `은행 충전 #${t.id}`], meta: { bankTx: t.id, amount },
  });
}
onJob('mint', {
  failed(job) { // 발행이 안 됐으면 준비금 → 통장으로 되돌림
    const m = JSON.parse(job.meta || '{}');
    if (m.bankTx) transfer(RESERVE, job.addr, m.amount, 'charge-refund', `충전 실패 되돌림 (#${m.bankTx})`, `refund:${job.id}`);
  },
});

/** 환매: 운영 지갑으로 보내는 서명 송금 → 받으면 준비금 → 통장, 이어서 소각 */
export function redeem(obj) {
  if (obj?.k !== 'redeem') throw new Error('환매 신청이 아닙니다');
  const v = verifyRelay(obj, cfg);
  if (!v.ok) throw new Error('서명이 맞지 않습니다');
  if (!addrEq(obj.auth.to, operator.address)) throw new Error('환매는 발행사 주소로 보내야 합니다');
  const a = big(obj.auth);
  if (a.value < 1n) throw new Error('금액은 1 sgw 이상');
  const s = splitSig(obj.sig);
  return enqueue({
    key: `redeem:${v.digest}`, kind: 'redeem', addr: a.from, label: `환매 ${a.value.toLocaleString()} sgw → 통장`,
    target: 'Seogilwon', method: 'transferWithAuthorization', args: [a.from, a.to, a.value, a.validAfter, a.validBefore, a.nonce, s.v, s.r, s.s],
    meta: { amount: Number(a.value) },
  });
}
onJob('redeem', {
  done(job) {
    const m = JSON.parse(job.meta || '{}');
    const t = transfer(RESERVE, job.addr, m.amount, 'redeem', '서길원 환매', `redeem:${job.id}`);
    enqueue({ key: `burn:${job.id}`, kind: 'burn', label: `환매분 소각 ${m.amount.toLocaleString()} sgw`, target: 'Seogilwon', method: 'burn', args: [m.amount, `은행 환매 #${t.id}`] });
  },
});

// ───── 대사: 준비금 = 총발행량 − 소각 대기분 ─────
let lastCheck = null;
export async function reconcile() {
  const t = contracts.Seogilwon;
  const [supply, held] = await Promise.all([t.totalSupply(), operator ? t.balanceOf(operator.address) : 0n]);
  if (!kvGet('bank.seeded')) {
    // 처음 켤 때: 이미 나가 있는 서길원만큼 준비금을 채워 시작점을 맞춘다
    const need = Number(supply - held) - balance(RESERVE);
    if (need > 0) transfer(TREASURY, RESERVE, need, 'seed', '기존 발행분 준비금 채우기', 'seed');
    kvSet('bank.seeded', '1');
  }
  const reserve = balance(RESERVE);
  lastCheck = { at: now(), supply: Number(supply), pendingBurn: Number(held), reserve, ok: reserve === Number(supply - held) };
  return lastCheck;
}
export const lastReconcile = () => lastCheck;
