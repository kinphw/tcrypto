// 참여자 요청 받기: 서명 검증 → 정책 확인 → 대기열에 넣기
import { cfg, provider, contracts, ifaces, operator, addrEq, nameOfContract, friendCoinAbi } from './chain.mjs';
import { db, now } from './db.mjs';
import { enqueue, reasonOf } from './queue.mjs';
import { charge, redeem } from './bank.mjs';
import { registerUser, getUser, joinsFromIpToday } from './rewards.mjs';
import { settings } from './db.mjs';
import { verifyRelay, payeeOk, big } from '../../web/js/core/relaykit.js';
import { splitSig } from '../../web/js/core/sigs.js';
import { ethers } from 'ethers';

const coinIface = new ethers.Interface(friendCoinAbi);
const FWD_TARGETS = ['Members', 'Market', 'CoinFactory', 'Bets', 'Coupons'];
const MAX_GAS = 3_000_000n;

const LABELS = {
  'Members.join': '가입', 'Market.openShop': '상점 열기', 'Market.setShopOpen': '상점 열고 닫기', 'Market.listProduct': '상품 올리기',
  'Market.updateProduct': '상품 수정', 'CoinFactory.createCoin': '내 코인 만들기', 'FriendCoin.mint': '내 코인 추가 발행',
  'FriendCoin.transfer': '코인 보내기', 'FriendCoin.transferWithMemo': '코인 보내기', 'FriendCoin.burn': '코인 태우기',
  'Bets.create': '내기 열기', 'Bets.resolve': '내기 결과 정하기', 'Bets.cancel': '내기 취소', 'Bets.claim': '내기 정산 받기',
  'Coupons.create': '쿠폰 만들기', 'Coupons.gift': '쿠폰 선물', 'Coupons.redeem': '쿠폰 사용', 'Coupons.setSale': '쿠폰 판매 설정',
};

const friendCoinSet = () => new Set(db.prepare("SELECT args FROM events WHERE contract = 'CoinFactory' AND name = 'CoinCreated'").all().map((r) => JSON.parse(r.args).coin.toLowerCase()));
const inflightFor = (addr) => db.prepare("SELECT COUNT(*) n FROM jobs WHERE addr = ? AND status IN ('queued', 'sent')").get(addr.toLowerCase()).n;

/** 지금 실행하면 거절될 요청은 바로 알려 준다. 단, 그 사람의 앞선 요청이 아직 처리 중이면 그 뒤에는 될 수 있으므로 받아 둔다 */
async function precheck(run, addr) {
  try { await run(); } catch (e) {
    if (inflightFor(addr) > 0) return;
    throw new Error(`지금은 할 수 없어요: ${friendly(reasonOf(e))}`);
  }
}

const FRIENDLY = [
  [/exceeds balance|transfer amount exceeds/i, '서길원 잔액이 부족해요'], [/betting closed/i, '이미 마감된 내기예요'], [/not closed yet/i, '아직 마감 전이에요'],
  [/creator only/i, '만든 사람만 할 수 있어요'], [/sold out|not enough stock/i, '남은 수량이 없어요'], [/name taken/i, '이미 있는 닉네임이에요'],
  [/already joined/i, '이미 가입했어요'], [/not enough coupons/i, '쿠폰이 부족해요'], [/cannot buy (from )?your own/i, '내 것은 살 수 없어요'],
  [/blacklisted/i, '이용이 제한된 계정이에요'], [/paused/i, '지금은 전체 거래가 잠시 멈춰 있어요'], [/nonce mismatch/i, '앞선 요청이 먼저 처리돼야 해요. 잠시 뒤 다시 해 주세요'],
  [/expired/i, '요청 유효기간이 지났어요'], [/shop closed/i, '가게가 문을 닫았어요'], [/not on sale/i, '지금 팔지 않는 상품이에요'],
];
export const friendly = (msg) => FRIENDLY.find(([re]) => re.test(msg))?.[1] || msg;

function describeFwd(req) {
  const name = nameOfContract(req.to) || 'FriendCoin';
  const iface = name === 'FriendCoin' ? coinIface : ifaces[name];
  const call = iface.parseTransaction({ data: req.data });
  if (!call) throw new Error('알 수 없는 함수입니다');
  return { name, method: call.name, args: call.args, label: LABELS[`${name}.${call.name}`] || call.name };
}

function checkFwd(obj) {
  const req = big(obj.req);
  const target = req.to.toLowerCase();
  const ok = FWD_TARGETS.some((n) => addrEq(cfg.contracts[n], target)) || friendCoinSet().has(target);
  if (!ok) throw new Error('이 서버가 대신 올려 주지 않는 대상입니다');
  if (req.gas > MAX_GAS) throw new Error('너무 큰 요청입니다');
  if (req.value !== 0n) throw new Error('ETH 를 보내는 요청은 받지 않습니다');
  if (req.deadline < BigInt(now())) throw new Error('유효기간이 지났습니다');
  return req;
}

/** POST /api/relay — 서명 봉투 하나 접수 */
export async function acceptRelay(obj) {
  if (!obj || typeof obj !== 'object' || !obj.k) throw new Error('요청이 비었습니다');
  if (obj.chainId !== cfg.network.chainId) throw new Error('다른 네트워크용 요청입니다');
  if (!operator) throw new Error('서버 준비 중입니다');
  if (obj.k === 'notice') return charge(obj);
  if (obj.k === 'redeem') return redeem(obj);
  if (obj.k === 'gas') throw new Error('ETH 요청은 받지 않습니다 (수수료는 언제나 발행사가 냅니다)');
  const v = verifyRelay(obj, cfg);
  if (!v.ok) throw new Error('서명이 맞지 않습니다');
  if (!payeeOk(obj, cfg)) throw new Error('결제 받는 곳이 맞지 않습니다');
  const key = `relay:${v.digest}`;
  const dup = db.prepare('SELECT * FROM jobs WHERE key = ?').get(key);
  if (dup) return { job: dup, duplicate: true };

  if (obj.k === 'fwd') {
    const req = checkFwd(obj);
    const d = describeFwd(req);
    if (d.name === 'Members' && d.method === 'join') throw new Error('가입은 가입 화면에서 해 주세요');
    await precheck(() => provider.call({ from: cfg.contracts.Forwarder, to: req.to, data: req.data + req.from.slice(2).toLowerCase() }), req.from);
    return enqueue({ key, kind: 'fwd', addr: req.from, label: d.label, target: 'Forwarder', method: 'execute', args: [obj.req, obj.sig], gas: req.gas + 120000n, meta: { call: `${d.name}.${d.method}` } });
  }
  const a = big(obj.auth);
  const s = splitSig(obj.sig);
  let job;
  if (obj.k === 'auth') {
    if (addrEq(a.to, operator.address)) throw new Error('발행사로 보내는 것은 환매 화면에서 해 주세요');
    if (Object.values(cfg.contracts).some((c) => addrEq(c, a.to))) throw new Error('컨트랙트 주소로는 보낼 수 없어요');
    job = { kind: 'auth', label: `${a.value.toLocaleString()} sgw 보내기`, target: 'Seogilwon', method: 'transferWithAuthorization', args: [a.from, a.to, a.value, a.validAfter, a.validBefore, a.nonce, s.v, s.r, s.s] };
  } else if (obj.k === 'buy') {
    job = { kind: 'buy', label: obj.label || '상품 구매', target: 'Market', method: 'buyWithAuthorization', args: [BigInt(obj.productId), BigInt(obj.quantity), String(obj.note || '').slice(0, 200), a.from, a.validAfter, a.validBefore, a.nonce, s.v, s.r, s.s] };
  } else if (obj.k === 'bet') {
    job = { kind: 'bet', label: obj.label || `내기 #${obj.betId} 걸기`, target: 'Bets', method: 'betWithAuthorization', args: [BigInt(obj.betId), Number(obj.option), a.from, a.value, a.validAfter, a.validBefore, a.nonce, s.v, s.r, s.s] };
  } else if (obj.k === 'cbuy') {
    job = { kind: 'cbuy', label: obj.label || '쿠폰 구매', target: 'Coupons', method: 'buyWithAuthorization', args: [BigInt(obj.couponId), BigInt(obj.amount), a.from, a.validAfter, a.validBefore, a.nonce, s.v, s.r, s.s] };
  } else throw new Error('알 수 없는 요청 종류');
  await precheck(() => contracts[job.target].getFunction(job.method).staticCall(...job.args, { from: operator.address }), a.from);
  return enqueue({ key, addr: a.from, ...job });
}

/** POST /api/join — 새 가입(명부 가입 서명) 또는 이미 명부에 있는 사람의 등록(본인 확인 서명) */
export async function acceptJoin(obj, invite, ip) {
  if (!obj || obj.chainId !== cfg.network.chainId) throw new Error('잘못된 요청입니다');
  const v = verifyRelay(obj, cfg);
  if (!v.ok) throw new Error('서명이 맞지 않습니다');
  if (obj.k === 'gas') { // 본인 확인용 서명 (이미 명부에 이름이 있는 사람)
    if (Math.abs(now() - Number(obj.gas.issuedAt)) > 600) throw new Error('확인 서명이 오래됐습니다. 다시 해 주세요');
    const addr = obj.gas.account;
    const name = await contracts.Members.nameOf(addr);
    if (!name) throw new Error('아직 가입하지 않은 지갑입니다');
    return { ...registerUser(addr, name, invite, ip), job: null };
  }
  if (obj.k !== 'fwd') throw new Error('가입 신청서가 아닙니다');
  const req = checkFwd(obj);
  const d = describeFwd(req);
  if (d.name !== 'Members' || d.method !== 'join') throw new Error('가입 신청서가 아닙니다');
  const name = String(d.args[0]).trim();
  if (name !== d.args[0] || !name || Buffer.byteLength(name) > 30) throw new Error('닉네임은 앞뒤 공백 없이 한글 10자(30바이트) 이내');
  if (getUser(req.from)) return { user: getUser(req.from), paid: [], job: null };
  if (db.prepare('SELECT 1 FROM users WHERE name = ?').get(name)) throw new Error('이미 있는 닉네임이에요');
  if (joinsFromIpToday(ip) >= settings().joinsPerIpPerDay) throw new Error('오늘 이 곳에서 가입할 수 있는 수를 넘었어요');
  const [mine, taken] = await Promise.all([contracts.Members.nameOf(req.from), contracts.Members.addrOf(name)]);
  if (mine) return { ...registerUser(req.from, mine, invite, ip), job: null };
  if (taken !== ethers.ZeroAddress) throw new Error('이미 있는 닉네임이에요');
  const { job } = enqueue({ key: `relay:${v.digest}`, kind: 'join', addr: req.from, label: `가입 (${name})`, target: 'Forwarder', method: 'execute', args: [obj.req, obj.sig], gas: req.gas + 120000n });
  return { ...registerUser(req.from, name, invite, ip), job };
}
