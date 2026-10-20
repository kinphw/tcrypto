// 색인된 이벤트로 화면용 자료 만들기: 이름표, 활동 피드, 순위, 내기·쿠폰·상품 목록
import { db, now } from './db.mjs';
import { cfg, operator } from './chain.mjs';
import { evs, chainNow } from './indexer.mjs';

const lc = (a) => String(a || '').toLowerCase();
const CONTRACT_ADDRS = new Set(Object.values(cfg.contracts).map(lc));
const ZERO = '0x0000000000000000000000000000000000000000';

export function names() {
  const m = {};
  for (const e of evs('Members', 'Joined')) m[lc(e.args.who)] = e.args.name;
  for (const u of db.prepare('SELECT addr, name FROM users').all()) m[u.addr] ??= u.name;
  return m;
}

// ───── 내기 ─────
export function allBets() {
  const map = new Map();
  for (const e of evs('Bets', 'Created')) {
    const a = e.args;
    map.set(Number(a.id), {
      id: Number(a.id), creator: lc(a.creator), question: a.question, options: a.options, closesAt: Number(a.closesAt), createdAt: e.time,
      pools: a.options.map(() => 0), pool: 0, stakes: {}, state: 'open', winner: null, resolvedAt: null, claimed: {}, bettors: 0,
    });
  }
  for (const e of evs('Bets', 'Placed')) {
    const b = map.get(Number(e.args.id)); if (!b) continue;
    const who = lc(e.args.who), opt = Number(e.args.option), amt = Number(e.args.amount);
    b.pools[opt] += amt; b.pool += amt;
    if (!b.stakes[who]) { b.stakes[who] = b.options.map(() => 0); b.bettors++; }
    b.stakes[who][opt] += amt;
  }
  for (const e of evs('Bets', 'Resolved')) {
    const b = map.get(Number(e.args.id)); if (!b) continue;
    b.state = 'resolved'; b.winner = Number(e.args.option); b.resolvedAt = e.time;
  }
  for (const e of evs('Bets', 'Cancelled')) {
    const b = map.get(Number(e.args.id)); if (!b) continue;
    b.state = 'cancelled'; b.resolvedAt = e.time;
  }
  for (const e of evs('Bets', 'Claimed')) {
    const b = map.get(Number(e.args.id)); if (!b) continue;
    b.claimed[lc(e.args.who)] = Number(e.args.amount);
  }
  const t = chainNow();
  for (const b of map.values()) if (b.state === 'open' && t >= b.closesAt) b.state = 'closed'; // 마감, 결과 대기
  return [...map.values()];
}

/** 받을 금액 (컨트랙트 claimable 과 같은 계산) */
export function payoutOf(b, who) {
  const st = b.stakes[who]; if (!st || b.state === 'open' || b.state === 'closed') return 0;
  const total = st.reduce((x, y) => x + y, 0);
  if (b.state === 'cancelled') return total;
  const win = b.pools[b.winner];
  return win === 0 ? total : Math.floor((st[b.winner] * b.pool) / win);
}

export function betView(b, me) {
  const mine = me && b.stakes[me] ? { stakes: b.stakes[me], payout: payoutOf(b, me), claimed: b.claimed[me] ?? null } : null;
  return {
    id: b.id, creator: b.creator, question: b.question, options: b.options, closesAt: b.closesAt, createdAt: b.createdAt,
    pools: b.pools, pool: b.pool, bettors: b.bettors, state: b.state, winner: b.winner, resolvedAt: b.resolvedAt, mine,
  };
}

// ───── 쿠폰 ─────
export function allCoupons() {
  const map = new Map();
  const add = (c, who, n) => { c.holders[who] = (c.holders[who] || 0) + n; if (c.holders[who] <= 0) delete c.holders[who]; };
  for (const e of evs('Coupons', 'Created')) {
    const a = e.args;
    const c = { id: Number(a.id), creator: lc(a.creator), name: a.name, description: a.description, price: Number(a.price), supply: Number(a.supply), onSale: Number(a.price) > 0, image: !!a.image, createdAt: e.time, sold: 0, redeemed: 0, holders: {}, uses: [] };
    add(c, c.creator, c.supply);
    map.set(c.id, c);
  }
  for (const e of evs('Coupons', 'SaleChanged')) { const c = map.get(Number(e.args.id)); if (c) { c.price = Number(e.args.price); c.onSale = e.args.onSale; } }
  for (const e of evs('Coupons', 'Bought')) { const c = map.get(Number(e.args.id)); if (!c) continue; const n = Number(e.args.amount); c.sold += n; add(c, c.creator, -n); add(c, lc(e.args.buyer), n); }
  for (const e of evs('Coupons', 'Gifted')) { const c = map.get(Number(e.args.id)); if (!c) continue; const n = Number(e.args.amount); add(c, lc(e.args.from), -n); add(c, lc(e.args.to), n); }
  for (const e of evs('Coupons', 'Redeemed')) {
    const c = map.get(Number(e.args.id)); if (!c) continue; const n = Number(e.args.amount);
    c.redeemed += n; add(c, lc(e.args.holder), -n);
    c.uses.push({ holder: lc(e.args.holder), amount: n, note: e.args.note, time: e.time });
  }
  return [...map.values()];
}
export const couponView = (c, me) => ({
  id: c.id, creator: c.creator, name: c.name, description: c.description, price: c.price, supply: c.supply, onSale: c.onSale, image: c.image,
  createdAt: c.createdAt, sold: c.sold, redeemed: c.redeemed, left: c.holders[c.creator] || 0, mine: me ? c.holders[me] || 0 : 0,
  uses: me === c.creator ? c.uses.slice(-20).reverse() : undefined,
});

// ───── 상점가 ─────
export function allProducts() {
  const shops = new Map();
  for (const e of evs('Market', 'ShopOpened')) shops.set(Number(e.args.shopId), { id: Number(e.args.shopId), owner: lc(e.args.owner), name: e.args.name, description: e.args.description, open: true });
  for (const e of evs('Market', 'ShopStatus')) { const s = shops.get(Number(e.args.shopId)); if (s) s.open = e.args.open; }
  const products = new Map();
  for (const e of evs('Market', 'ProductListed')) {
    const a = e.args;
    products.set(Number(a.productId), { id: Number(a.productId), shopId: Number(a.shopId), name: a.name, description: a.description, price: Number(a.price), stock: Number(a.stock), sold: 0, active: true, image: !!a.image, createdAt: e.time });
  }
  for (const e of evs('Market', 'ProductUpdated')) { const p = products.get(Number(e.args.productId)); if (p) { p.price = Number(e.args.price); p.stock = Number(e.args.stock); p.active = e.args.active; } }
  for (const e of evs('Market', 'Purchased')) { const p = products.get(Number(e.args.productId)); if (p) { p.stock -= Number(e.args.quantity); p.sold += Number(e.args.quantity); } }
  return { shops: [...shops.values()], products: [...products.values()].map((p) => ({ ...p, shop: shops.get(p.shopId) })) };
}

// ───── 잔액 (Transfer 이벤트를 더한 값) ─────
export function sgwBalances() {
  const bal = {};
  for (const e of evs('Seogilwon', 'Transfer')) {
    const v = Number(e.args.value);
    bal[lc(e.args.from)] = (bal[lc(e.args.from)] || 0) - v;
    bal[lc(e.args.to)] = (bal[lc(e.args.to)] || 0) + v;
  }
  delete bal[ZERO];
  return bal;
}

// ───── 활동 피드 ─────
const FEED = [
  ['Members', 'Joined'], ['Seogilwon', 'Transfer'], ['Market', 'Purchased'], ['Market', 'ProductListed'],
  ['Bets', 'Created'], ['Bets', 'Resolved'], ['Bets', 'Placed'], ['Bets', 'Claimed'],
  ['Coupons', 'Created'], ['Coupons', 'Bought'], ['Coupons', 'Gifted'], ['Coupons', 'Redeemed'], ['CoinFactory', 'CoinCreated'],
];
export function feed(limit = 40, me = null) {
  const op = lc(operator?.address);
  const where = FEED.map(() => '(contract = ? AND name = ?)').join(' OR ');
  const rows = db.prepare(`SELECT * FROM events WHERE ${where} ORDER BY block DESC, idx DESC LIMIT ?`).all(...FEED.flat(), limit * 3);
  const bets = new Map(allBets().map((b) => [b.id, b]));
  const coupons = new Map(allCoupons().map((c) => [c.id, c]));
  const items = [];
  for (const r of rows) {
    const a = JSON.parse(r.args);
    const base = { time: r.time, tx: r.tx, raw: { block: r.block, contract: r.contract, event: r.name, args: a } }; // raw: '자세히 보기'용 이벤트 원본
    const k = `${r.contract}.${r.name}`;
    if (k === 'Members.Joined') items.push({ ...base, kind: 'join', who: lc(a.who) });
    else if (k === 'Seogilwon.Transfer') {
      const from = lc(a.from), to = lc(a.to);
      if (from === lc(ZERO)) items.push({ ...base, kind: 'charge', who: to, amount: Number(a.value) });
      else if (to === op) items.push({ ...base, kind: 'redeem', who: from, amount: Number(a.value) });
      else if (!CONTRACT_ADDRS.has(from) && !CONTRACT_ADDRS.has(to) && to !== lc(ZERO) && from !== op) items.push({ ...base, kind: 'send', who: from, to, amount: Number(a.value) });
    } else if (k === 'Market.Purchased') items.push({ ...base, kind: 'buy', who: lc(a.buyer), to: lc(a.seller), amount: Number(a.total), productId: Number(a.productId) });
    else if (k === 'Market.ProductListed') items.push({ ...base, kind: 'product', productId: Number(a.productId), title: a.name, amount: Number(a.price) });
    else if (k === 'Bets.Created') items.push({ ...base, kind: 'bet-new', who: lc(bets.get(Number(a.id))?.creator), betId: Number(a.id), title: a.question });
    else if (k === 'Bets.Placed') items.push({ ...base, kind: 'bet-place', who: lc(a.who), betId: Number(a.id), title: bets.get(Number(a.id))?.question, option: bets.get(Number(a.id))?.options[Number(a.option)], amount: Number(a.amount) });
    else if (k === 'Bets.Resolved') items.push({ ...base, kind: 'bet-result', betId: Number(a.id), title: bets.get(Number(a.id))?.question, option: bets.get(Number(a.id))?.options[Number(a.option)] });
    else if (k === 'Bets.Claimed') {
      const b = bets.get(Number(a.id));
      const staked = (b?.stakes[lc(a.who)] || []).reduce((x, y) => x + y, 0);
      if (b?.state === 'resolved' && Number(a.amount) > staked) items.push({ ...base, kind: 'bet-win', who: lc(a.who), betId: Number(a.id), title: b.question, amount: Number(a.amount) - staked });
    } else if (k === 'Coupons.Created') items.push({ ...base, kind: 'coupon-new', who: lc(a.creator), couponId: Number(a.id), title: a.name, amount: Number(a.price) });
    else if (k === 'Coupons.Bought') items.push({ ...base, kind: 'coupon-buy', who: lc(a.buyer), couponId: Number(a.id), title: coupons.get(Number(a.id))?.name, amount: Number(a.total) });
    else if (k === 'Coupons.Gifted') items.push({ ...base, kind: 'coupon-gift', who: lc(a.from), to: lc(a.to), couponId: Number(a.id), title: coupons.get(Number(a.id))?.name, message: a.message });
    else if (k === 'Coupons.Redeemed') items.push({ ...base, kind: 'coupon-use', who: lc(a.holder), to: lc(a.creator), couponId: Number(a.id), title: coupons.get(Number(a.id))?.name });
    else if (k === 'CoinFactory.CoinCreated') items.push({ ...base, kind: 'coin-new', who: lc(a.issuer), title: `${a.name} (${a.symbol})` });
    if (items.length >= limit) break;
  }
  if (me) return items.filter((i) => i.who === me || i.to === me);
  return items;
}

// ───── 순위 ─────
export function ranking() {
  const op = lc(operator?.address);
  const nm = names();
  const sgw = sgwBalances();
  const bank = Object.fromEntries(db.prepare("SELECT id, balance FROM bank_accounts WHERE id NOT IN ('reserve', 'treasury')").all().map((r) => [r.id, r.balance]));
  const people = new Set([...Object.keys(nm), ...Object.keys(bank)]);
  const rich = [...people].filter((a) => a !== op && !CONTRACT_ADDRS.has(a)).map((a) => ({ addr: a, sgw: sgw[a] || 0, bank: bank[a] || 0, total: (sgw[a] || 0) + (bank[a] || 0) }))
    .sort((x, y) => y.total - x.total).slice(0, 20);
  const net = {};
  for (const b of allBets()) {
    if (b.state !== 'resolved') continue;
    for (const [who, st] of Object.entries(b.stakes)) net[who] = (net[who] || 0) + payoutOf(b, who) - st.reduce((x, y) => x + y, 0);
  }
  const betKing = Object.entries(net).map(([addr, n]) => ({ addr, net: n })).sort((x, y) => y.net - x.net).slice(0, 10);
  const coupons = allCoupons().map((c) => ({ id: c.id, name: c.name, creator: c.creator, sold: c.sold, redeemed: c.redeemed })).sort((x, y) => y.sold - x.sold).slice(0, 10);
  return { rich, betKing, coupons };
}
