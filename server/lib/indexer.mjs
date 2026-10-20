// 이벤트 색인: 블록체인의 이벤트를 서버 DB 에 복사해 둔다 (피드·순위·내기·쿠폰 목록을 빠르게 보여 주려고).
// 원본은 언제나 블록체인이다. DB 를 지워도 처음부터 다시 쌓으면 같은 결과가 나온다.
import { db, kvGet, kvSet } from './db.mjs';
import { cfg, provider, contracts, ifaces, friendCoinAbi } from './chain.mjs';
import { ethers } from 'ethers';

const WATCH = ['Seogilwon', 'Members', 'Market', 'CoinFactory', 'Bets', 'Coupons'].filter((n) => contracts[n]);
const byAddr = new Map(WATCH.map((n) => [cfg.contracts[n].toLowerCase(), n]));
const coinIface = new ethers.Interface(friendCoinAbi);
const IMAGE_EVENTS = { 'Market.ProductListed': ['product', 'productId'], 'Coupons.Created': ['coupon', 'id'] };

const plain = (v) => (typeof v === 'bigint' ? v.toString() : Array.isArray(v) ? v.map(plain) : v);

let head = 0;
let headTime = 0;
/** 체인 시각 (블록 시각과 서버 시계 중 늦은 쪽). 마감·정산 판단은 컨트랙트와 같은 기준이어야 한다 */
export const chainNow = () => Math.max(Math.floor(Date.now() / 1000), headTime);
export const indexedTo = () => Number(kvGet('index.block', String((cfg.deployBlock || 0) - 1)));
export const chainHead = () => head;

async function blockTimes(nums) {
  const out = new Map();
  for (let i = 0; i < nums.length; i += 10) {
    const bs = await Promise.all(nums.slice(i, i + 10).map((n) => provider.getBlock(n)));
    bs.forEach((b, k) => out.set(nums[i + k], b?.timestamp ?? 0));
  }
  return out;
}

function store(logs, times) {
  const ins = db.prepare('INSERT OR IGNORE INTO events(block, idx, tx, contract, name, args, time, a1, a2) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const img = db.prepare('INSERT OR REPLACE INTO images(kind, id, mime, data) VALUES (?, ?, ?, ?)');
  db.exec('BEGIN');
  try {
    for (const log of logs) {
      const name = byAddr.get(log.address.toLowerCase()) || 'FriendCoin';
      const iface = name === 'FriendCoin' ? coinIface : ifaces[name];
      let ev;
      try { ev = iface.parseLog(log); } catch { continue; }
      if (!ev) continue;
      const args = {};
      ev.fragment.inputs.forEach((inp, i) => { args[inp.name] = plain(ev.args[i]); });
      const key = `${name}.${ev.name}`;
      if (IMAGE_EVENTS[key]) {
        const [kind, idField] = IMAGE_EVENTS[key];
        if (args.image && args.image !== '0x') img.run(kind, Number(args[idField]), args.mime || 'image/jpeg', Buffer.from(args.image.slice(2), 'hex'));
        args.image = args.image && args.image !== '0x' ? true : false;
      }
      if (name === 'FriendCoin') args.coin = log.address;
      const addrs = ev.fragment.inputs.map((inp, i) => (inp.type === 'address' ? String(ev.args[i]).toLowerCase() : null)).filter(Boolean);
      ins.run(log.blockNumber, log.index, log.transactionHash, name, ev.name, JSON.stringify(args), times.get(log.blockNumber) || 0, addrs[0] || null, addrs[1] || null);
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

const friendCoins = () => db.prepare("SELECT args FROM events WHERE contract = 'CoinFactory' AND name = 'CoinCreated'").all().map((r) => JSON.parse(r.args).coin);

let step = 5000;
async function runOnce() {
  const latest = await provider.getBlock('latest');
  head = latest.number;
  headTime = latest.timestamp;
  let from = indexedTo() + 1;
  // 마지막 몇 블록은 다시 훑는다 (체인 끝이 잠깐 바뀌는 경우 대비, 중복은 무시됨)
  if (from > (cfg.deployBlock || 0) + 3) from -= 3;
  while (from <= head) {
    const to = Math.min(from + step - 1, head);
    let logs;
    try {
      logs = await provider.getLogs({ address: [...WATCH.map((n) => cfg.contracts[n]), ...friendCoins()], fromBlock: from, toBlock: to });
    } catch (e) {
      if (step > 100) { step = Math.floor(step / 2); continue; }
      throw e;
    }
    const times = await blockTimes([...new Set(logs.map((l) => l.blockNumber))]);
    store(logs, times);
    kvSet('index.block', String(to));
    from = to + 1;
  }
}

const listeners = new Set();
export const onIndexed = (fn) => listeners.add(fn);
let busy = false;
export async function indexTick() {
  if (busy) return;
  busy = true;
  try {
    await runOnce();
    for (const f of listeners) await f();
  } catch (e) {
    console.warn('[index]', e.shortMessage || e.message);
  } finally { busy = false; }
}
export function startIndexer() {
  indexTick();
  setInterval(indexTick, 6000);
}

// ───── 읽기 도우미 ─────
export const evs = (contract, name, where = '', ...params) =>
  db.prepare(`SELECT * FROM events WHERE contract = ? AND name = ? ${where} ORDER BY block, idx`).all(contract, name, ...params)
    .map((r) => ({ ...r, args: JSON.parse(r.args) }));
