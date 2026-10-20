// 운영 서버 전체 흐름 자동 점검 — 로컬 시험망 + 로컬 서버에서 실행.
//   node tools-js/server-test.mjs http://127.0.0.1:4301 <관리 비밀번호>
// 친구 둘(앨리스·밥)이 ETH 없이: 가입 → 출석 → 초대 → 충전(발행) → 송금 → 내기 → 자동 정산 → 쿠폰 → 환매(소각)
// 매 단계 뒤 '준비금 = 총발행량 − 소각 대기분' 을 확인한다.
import { ethers } from 'ethers';

globalThis.ethers = ethers;
const S = await import('../web/js/core/sigs.js');
const [BASE, ADMIN_PW] = process.argv.slice(2);
let fails = 0;
const ok = (c, m) => { console.log(c ? '  ✔' : '  ✘', m); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let cookie = '';
async function call(path, body, { admin = false } = {}) {
  const r = await fetch(BASE + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', ...(admin ? { 'x-tc': '1', cookie } : {}) },
    body: body ? JSON.stringify(body, (k, v) => (typeof v === 'bigint' ? v.toString() : v)) : undefined,
  });
  if (r.headers.get('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0];
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || r.status);
  return j;
}
const expectFail = async (fn, m) => { try { await fn(); ok(false, `${m} (거절돼야 하는데 통과)`); } catch (e) { ok(true, `${m} → ${e.message}`); } };
async function waitJob(id, ms = 30000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const j = await call(`/api/job/${id}`);
    if (j.status === 'done' || j.status === 'failed') return j;
    await sleep(500);
  }
  throw new Error(`작업 #${id} 시간 초과`);
}
// 서버 색인이 지금 체인 끝까지 따라왔는지 기다림
const waitIndexed = async () => { const h = await p.getBlockNumber(); while ((await call('/api/status')).indexed < h) await sleep(500); };

const cfg = await call('/api/config');
const chainId = cfg.network.chainId;
const p = new ethers.JsonRpcProvider(cfg.network.rpc, undefined, { cacheTimeout: -1 });
const fwdAbi = (await import('../tools-js/deploy-lib.mjs')).art;
const art = fwdAbi;
const forwarder = new ethers.Contract(cfg.contracts.Forwarder, art('Forwarder').abi, p);
const token = new ethers.Contract(cfg.contracts.Seogilwon, art('SeogilwonV2').abi, p);
const I = Object.fromEntries(['Members', 'Bets', 'Coupons', 'Market'].map((n) => [n, new ethers.Interface(art(n).abi)]));
const [alice, bob] = [1, 2].map(() => ethers.Wallet.createRandom());

const fwd = async (user, name, method, args, label) => {
  const data = I[name].encodeFunctionData(method, args);
  const req = await S.buildForwardRequest({ forwarder, from: user.address, to: cfg.contracts[name], data, gas: 1_500_000 });
  const sig = await user.signTypedData(S.forwarderDomain(chainId, cfg.contracts.Forwarder), { ForwardRequest: S.TYPES.ForwardRequest }, req);
  return { k: 'fwd', chainId, label, req, sig };
};
const auth = async (user, kind, k, to, value, extra = {}) => {
  const a = S.buildAuthorization({ from: user.address, to, value });
  const sig = await user.signTypedData(S.tokenDomain(chainId, cfg.contracts.Seogilwon), { [kind]: S.TYPES[kind] }, a);
  return { k, chainId, auth: a, sig, ...extra };
};
const notice = async (user, amount) => {
  const n = { account: user.address, amount: BigInt(amount), memo: '충전', issuedAt: BigInt(Math.floor(Date.now() / 1000)) };
  return { k: 'notice', chainId, notice: n, sig: await user.signTypedData(S.tokenDomain(chainId, cfg.contracts.Seogilwon), { DepositNotice: S.TYPES.DepositNotice }, n) };
};
const relay = async (obj) => waitJob((await call('/api/relay', { obj })).job.id);
const me = (u) => call(`/api/me/${u.address}`);
async function reconciled(m) {
  await call('/api/admin/login', { password: ADMIN_PW });
  const o = await call('/api/admin/overview', null, { admin: true });
  ok(o.reconcile.ok, `${m}: 준비금 ${o.reconcile.reserve} = 총발행 ${o.reconcile.supply} − 소각 대기 ${o.reconcile.pendingBurn}`);
}

console.log('■ 관리자 로그인 · 설정');
await expectFail(() => call('/api/admin/overview', null, { admin: true }), '로그인 없이 관리 API');
await expectFail(() => call('/api/admin/login', { password: 'wrong' }), '틀린 비밀번호');
await call('/api/admin/login', { password: ADMIN_PW });
await call('/api/admin/settings', { settleGraceMinutes: 0 }, { admin: true });
ok((await call('/api/admin/overview', null, { admin: true })).settings.settleGraceMinutes === 0, '정산 유예 0분으로 (시험용)');

console.log('\n■ 가입 · 초대 · 출석 (은행 통장으로 보상)');
let r = await call('/api/join', { obj: await fwd(alice, 'Members', 'join', ['앨리스'], '가입') });
ok(r.name === '앨리스' && r.paid.some((x) => x.kind === 'signup'), `앨리스 가입 → 축하금 ${r.paid[0]?.amount}원`);
await waitJob(r.job.id);
await expectFail(async () => call('/api/join', { obj: await fwd(bob, 'Members', 'join', ['앨리스'], '가입') }), '같은 닉네임');
r = await call('/api/join', { obj: await fwd(bob, 'Members', 'join', ['밥'], '가입'), invite: '앨리스' });
ok(r.paid.some((x) => x.kind === 'invite'), '밥이 앨리스 초대 링크로 가입 → 초대 보상');
await waitJob(r.job.id);
let ma = await me(alice);
ok(ma.bank === cfg.rewards.signupBonus + cfg.rewards.inviteReward && ma.invited === 1, `앨리스 통장 ${ma.bank}원 (축하금 + 초대 보상)`);
r = await call('/api/checkin', { addr: alice.address });
ok(!r.already && r.streak === 1, '앨리스 출석 1일째');
r = await call('/api/checkin', { addr: alice.address });
ok(r.already, '같은 날 두 번 출석은 안 됨');
ma = await me(alice);
const bankA = ma.bank;

console.log('\n■ 충전 (통장 → 준비금, 같은 금액 발행)');
const n1 = await notice(alice, 60000);
let j = await waitJob((await call('/api/relay', { obj: n1 })).job.id);
ok(j.status === 'done', '앨리스 6만원 충전 → 발행 완료');
r = await call('/api/relay', { obj: n1 });
ok(r.duplicate, '같은 충전 신청서 다시 보내도 한 번만 (중복 방지)');
ma = await me(alice);
ok(ma.bank === bankA - 60000 && ma.sgw === 60000, `통장 ${ma.bank}원 · 지갑 ${ma.sgw} sgw`);
await expectFail(async () => call('/api/relay', { obj: await notice(alice, 999999999) }), '통장 잔액보다 큰 충전');
j = await waitJob((await call('/api/relay', { obj: await notice(bob, 40000) })).job.id);
await reconciled('충전 뒤');

console.log('\n■ 송금 (서명만, 수수료는 서버)');
j = await relay(await auth(alice, 'TransferWithAuthorization', 'auth', bob.address, 5000));
ok(j.status === 'done' && (await me(bob)).sgw === 45000, '앨리스 → 밥 5,000 sgw');
ok((await p.getBalance(alice.address)) === 0n, '앨리스 ETH 0 그대로');

console.log('\n■ 내기 (열기 → 걸기 → 결과 → 자동 정산)');
const closes = (await p.getBlock('latest')).timestamp + 120;
j = await relay(await fwd(alice, 'Bets', 'create', ['점심 짜장 vs 짬뽕', ['짜장', '짬뽕'], closes], '내기 열기'));
ok(j.status === 'done', '앨리스가 내기 열기');
await waitIndexed();
const bets = await call('/api/bets');
const bet = bets[0];
ok(bet.question === '점심 짜장 vs 짬뽕' && bet.state === 'open', '서버 목록에 새 내기');
j = await relay(await auth(alice, 'ReceiveWithAuthorization', 'bet', cfg.contracts.Bets, 10000, { betId: bet.id, option: 0 }));
ok(j.status === 'done', '앨리스 짜장에 10,000');
j = await relay(await auth(bob, 'ReceiveWithAuthorization', 'bet', cfg.contracts.Bets, 30000, { betId: bet.id, option: 1 }));
ok(j.status === 'done', '밥 짬뽕에 30,000');
await expectFail(async () => call('/api/relay', { obj: await auth(bob, 'ReceiveWithAuthorization', 'bet', cfg.contracts.Market, 100, { betId: bet.id, option: 1 }) }), '받는 곳이 내기판이 아닌 걸기 서명');
await p.send('evm_increaseTime', [130]); await p.send('evm_mine', []);
j = await relay(await fwd(alice, 'Bets', 'resolve', [bet.id, 1], '결과'));
ok(j.status === 'done', '앨리스가 결과 = 짬뽕 (정직하게)');
const bobBefore = (await me(bob)).sgw;
let paid = false;
for (let i = 0; i < 40 && !paid; i++) { await sleep(1000); paid = (await me(bob)).sgw === bobBefore + 40000; }
ok(paid, '서버가 자동 정산 → 밥 +40,000 (판돈 전부)');
await waitIndexed();
const feed = await call('/api/feed');
ok(feed.some((f) => f.kind === 'bet-win' && f.who === bob.address.toLowerCase()), '피드에 "밥이 내기에서 땀"');

console.log('\n■ 쿠폰 (만들기 → 사기 → 선물 → 쓰기)');
const png = '0x89504e470d0a1a0a';
j = await relay(await fwd(alice, 'Coupons', 'create', ['커피 쿠폰', '아아 한 잔', 'image/png', png, 3, 4500], '쿠폰 만들기'));
ok(j.status === 'done', '앨리스 커피 쿠폰 3장 (4,500)');
await waitIndexed();
const cp = (await call('/api/coupons'))[0];
j = await relay(await auth(bob, 'ReceiveWithAuthorization', 'cbuy', cfg.contracts.Coupons, 4500, { couponId: cp.id, amount: 1 }));
ok(j.status === 'done', '밥이 1장 구매');
j = await relay(await fwd(bob, 'Coupons', 'redeem', [cp.id, 1, '내일 오전'], '쿠폰 사용'));
ok(j.status === 'done', '밥이 쿠폰 사용');
await waitIndexed();
const mine = (await call(`/api/coupons?me=${alice.address}`)).find((c) => c.id === cp.id);
ok(mine.uses?.[0]?.note === '내일 오전' && mine.left === 2, '앨리스(만든 사람) 화면에 사용 기록, 남은 2장');
const imgRes = await fetch(`${BASE}/api/img/coupon/${cp.id}`);
ok(imgRes.ok && imgRes.headers.get('content-type') === 'image/png', '쿠폰 사진 제공');

console.log('\n■ 환매 (서길원 → 발행사 → 소각, 통장으로 원화)');
const bBank = (await me(bob)).bank;
const bSgw = (await me(bob)).sgw;
j = await relay(await auth(bob, 'TransferWithAuthorization', 'redeem', cfg.operator, 20000));
ok(j.status === 'done', '밥 20,000 sgw 환매 신청 처리');
let burned = false;
for (let i = 0; i < 30 && !burned; i++) { await sleep(1000); burned = (await call('/api/admin/overview', null, { admin: true })).reconcile.pendingBurn === 0; }
const mb = await me(bob);
ok(mb.bank === bBank + 20000 && mb.sgw === bSgw - 20000, `밥 통장 +20,000원, 지갑 −20,000 sgw`);
await expectFail(async () => call('/api/relay', { obj: await auth(bob, 'TransferWithAuthorization', 'auth', cfg.operator, 1) }), '환매가 아닌 송금으로 발행사에 보내기');
await reconciled('환매·소각 뒤');

console.log('\n■ 순위 · 관리');
const rank = await call('/api/rank');
ok(rank.rich.length >= 2 && rank.betKing[0]?.addr === bob.address.toLowerCase(), `부자 순위 ${rank.rich.length}명, 내기왕 = 밥`);
const users = await call('/api/admin/users', null, { admin: true });
ok(users.some((u) => u.name === '밥' && u.invitedBy === alice.address.toLowerCase()), '관리: 사용자 목록 (초대 관계)');
r = await call('/api/admin/grant', { who: '밥', amount: 7777, memo: '이벤트' }, { admin: true });
ok((await me(bob)).bank === mb.bank + 7777, '관리: 밥에게 7,777원 지급');
await call('/api/admin/settings', { settleGraceMinutes: 60 }, { admin: true });

console.log(fails ? `\n실패 ${fails}건 ✘` : '\n운영 서버 전체 흐름 통과 ✅');
process.exit(fails ? 1 : 0);
