// 자동 처리기: 발행사의 '서버' 역할. 이 기기 브라우저에 전용 지갑을 하나 두고, 켜 두면 요청함을 주기적으로 읽어
//  - 대납 요청(송금·결제·상점 등)은 이 지갑이 수수료를 내고 올리고
//  - 입금 신청은 이 지갑이 '발행 담당(minter)'으로서 정해진 한도 안에서 발행한다.
// 실제 발행사도 자동 발행 서버에 '한도가 정해진 발행 담당 키'를 주고, 한도를 정하는 발행 총괄 키는 따로 보관한다.
// 이 지갑의 열쇠는 이 브라우저(localStorage)에만 있다 → 시험용 ETH 만 넣는다.
import { chain, getContract, withFeeHint, relayerLabels } from './chain.js';
import { readInbox, requestStatus } from './inbox.js';
import { submitRelay, approveNotice } from './relay.js';
import { won } from './ui.js';

const E = () => globalThis.ethers;
const key = (name) => `tcrypto.relayer.${name}.${chain.cfg.network.chainId}`;
const get = (name) => { try { return localStorage.getItem(key(name)); } catch { return null; } };
const set = (name, v) => { try { v == null ? localStorage.removeItem(key(name)) : localStorage.setItem(key(name), v); } catch {} };

export const INTERVAL_MS = 15000;
export const DEFAULT_MAX_MINT = 100000n; // 입금 신청 한 건당 자동 발행 상한 (넘으면 사람이 직접)

let wallet = null;
export function relayer() {
  if (wallet) return wallet;
  const pk = get('key');
  if (!pk) return null;
  wallet = withFeeHint(new (E().Wallet)(pk, chain.provider));
  relayerLabels.add(wallet.address.toLowerCase());
  return wallet;
}
export function createRelayer() {
  const w = E().Wallet.createRandom();
  set('key', w.privateKey);
  wallet = null;
  return relayer();
}
export function forgetRelayer() { stop(); set('key', null); set('on', null); wallet = null; }

export const isOn = () => get('on') === '1';
export const maxMint = () => BigInt(get('max') || DEFAULT_MAX_MINT);
export const setMaxMint = (v) => set('max', String(v));

/** 자동 처리기 상태: 주소, ETH, 발행 권한·한도 */
export async function relayerStatus() {
  const w = relayer();
  if (!w) return null;
  const t = await getContract('Seogilwon');
  const [eth, minter, allowance] = await Promise.all([chain.provider.getBalance(w.address), t.isMinter(w.address), t.minterAllowance(w.address)]);
  return { address: w.address, eth, minter, allowance };
}

// ───────── 처리 기록 (이 기기에만, 최근 50건) ─────────
const listeners = new Set();
export const onActivity = (fn) => (listeners.add(fn), () => listeners.delete(fn));
export function activity() { try { return JSON.parse(get('log') || '[]'); } catch { return []; } }
function log(entry) {
  const list = [{ time: Math.floor(Date.now() / 1000), ...entry }, ...activity()].slice(0, 50);
  set('log', JSON.stringify(list));
  listeners.forEach((f) => { try { f(list); } catch {} });
}

/** 요청함을 한 번 훑어 처리 가능한 것을 오래된 순서대로 처리 */
let busy = false;
const noted = new Set(); // 건너뛴 이유는 요청마다 한 번만 기록
const skip = (it, why) => { if (!noted.has(it.id + why)) { noted.add(it.id + why); log({ ok: false, label: `${it.obj.label} — ${why}` }); } };
export async function runOnce() {
  // 같은 브라우저의 여러 탭이 동시에 처리기를 돌리면 같은 요청을 두 번 올림 → 탭 사이 잠금(Web Locks)으로 한 탭만
  if (navigator.locks) return navigator.locks.request('tcrypto-relayer', { ifAvailable: true }, (lock) => (lock ? runInner() : 0));
  return runInner();
}
async function runInner() {
  const w = relayer();
  if (!w || busy) return 0;
  busy = true;
  let done = 0;
  try {
    const { items } = await readInbox();
    const st = await relayerStatus();
    if (st.eth === 0n) { skip({ id: 'eth', obj: { label: '자동 처리기' } }, '수수료용 ETH 가 없습니다 — 충전이 필요합니다'); return 0; }
    const ctx = {};
    for (const it of items.slice().sort((a, b) => a.time - b.time)) {
      const s = await requestStatus(it.obj, it.v, ctx).catch(() => ['bad']);
      if (s[0] !== 'ready') continue;
      const k = it.obj.k;
      if (k === 'gas') continue; // 참여자에게 ETH 는 주지 않음 (토큰만 쓰는 실제 스테이블코인처럼)
      if (k === 'notice') {
        const amt = BigInt(it.obj.notice.amount);
        if (!st.minter) { skip(it, '자동 처리기에 발행 권한이 없어 건너뜀'); continue; }
        if (amt > maxMint()) { skip(it, `자동 발행 상한(${won(maxMint())}) 초과, 발행자가 직접 처리`); continue; }
        if (amt > st.allowance) { skip(it, '남은 발행 한도 부족'); continue; }
      }
      const again = await requestStatus(it.obj, it.v, {}).catch(() => ['bad']);
      if (again[0] !== 'ready') continue;
      try {
        const r = k === 'notice' ? await approveNotice(it.obj, w, { auto: true }) : await submitRelay(it.obj, w);
        log({ ok: r.status === 1, label: it.obj.label, tx: r.hash });
        if (r.status === 1) { done++; if (k === 'notice') st.allowance -= BigInt(it.obj.notice.amount); }
        ctx.fwdNonce = undefined; // 같은 사람의 다음 요청 순서를 다시 읽도록
      } catch (e) {
        log({ ok: false, label: `${it.obj.label} — 실패: ${e.shortMessage || e.message}` });
      }
    }
  } catch (e) {
    log({ ok: false, label: `요청함 읽기 실패: ${e.message}` });
  } finally {
    busy = false;
  }
  return done;
}

// ───────── 켜기 / 끄기 (화면을 옮겨도 계속 돌도록 app.js 에서 시작) ─────────
let timer = null;
export function start() {
  set('on', '1');
  if (timer || !relayer()) return;
  runOnce();
  timer = setInterval(runOnce, INTERVAL_MS);
}
export function stop() {
  set('on', null);
  clearInterval(timer);
  timer = null;
}
export const running = () => !!timer;
/** 사이트를 열 때: 이 기기에서 켜 두었던 자동 처리기를 이어서 돌림 */
export function resume() { if (isOn() && relayer()) start(); }
