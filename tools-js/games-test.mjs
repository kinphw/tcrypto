// 내기판·쿠폰 시장 자동 점검 — 로컬 시험망(npx hardhat node)에서 실행.
//   node tools-js/games-test.mjs <rpcUrl> <발행자 개인키>
// 친구들은 ETH 가 0 인 새 지갑이다. 걸기·사기는 서명 결제, 나머지는 대납 중계로 한다.
import { ethers } from 'ethers';
import { deployAll, deployGames, art } from './deploy-lib.mjs';

globalThis.ethers = ethers;
const S = await import('../web/js/core/sigs.js');
const [rpcUrl, pk] = process.argv.slice(2);
const p = new ethers.JsonRpcProvider(rpcUrl, undefined, { pollingInterval: 300, cacheTimeout: -1 }); // 캐시를 끄지 않으면 빠른 연속 거래에서 nonce 를 묵은 값으로 받음
const issuer = new ethers.Wallet(pk, p); // 거래마다 기다리므로 nonce 는 노드에 그때그때 물음
const me = issuer.address;
const [alice, bob, carol, dave] = [1, 2, 3, 4].map(() => ethers.Wallet.createRandom().connect(p));
const chainId = Number((await p.getNetwork()).chainId);
let fails = 0;
const ok = (c, m) => { console.log(c ? '  ✔' : '  ✘', m); if (!c) fails++; };
const expectRevert = async (fn, m) => { try { await fn(); ok(false, `${m} (거절돼야 하는데 통과)`); } catch (e) { ok(true, `${m} → 거절: ${e.reason || e.shortMessage}`); } };
const wait = async (txp) => (await txp).wait();
const now = async () => (await p.getBlock('latest')).timestamp;
const warp = async (sec) => { await p.send('evm_increaseTime', [sec]); await p.send('evm_mine', []); };

console.log('■ 배포');
const C = await deployAll(issuer, () => {});
Object.assign(C, await deployGames(issuer, { ...C, admin: me }));
const token = new ethers.Contract(C.Seogilwon, art('SeogilwonV1').abi, issuer);
const fwd = new ethers.Contract(C.Forwarder, art('Forwarder').abi, issuer);
const bets = new ethers.Contract(C.Bets, art('Bets').abi, issuer);
const coupons = new ethers.Contract(C.Coupons, art('Coupons').abi, issuer);
for (const u of [alice, bob, carol, dave]) await wait(token.mint(u.address, 100000, '시험 충전'));

const relayFwd = async (user, target, fn, args, gas = 800000) => {
  const data = target.interface.encodeFunctionData(fn, args);
  const req = await S.buildForwardRequest({ forwarder: fwd, from: user.address, to: await target.getAddress(), data, gas });
  const sig = await user.signTypedData(S.forwarderDomain(chainId, C.Forwarder), { ForwardRequest: S.TYPES.ForwardRequest }, req);
  return wait(fwd.execute(req, sig)); // 중계기는 대상의 거절 사유를 그대로 돌려준다
};
const signRecv = async (user, to, value) => {
  const a = S.buildAuthorization({ from: user.address, to, value });
  const sig = await user.signTypedData(S.tokenDomain(chainId, C.Seogilwon), { ReceiveWithAuthorization: S.TYPES.ReceiveWithAuthorization }, a);
  return { a, ...S.splitSig(sig) };
};
const placeBet = async (user, id, option, value) => {
  const au = await signRecv(user, C.Bets, value);
  return wait(bets.betWithAuthorization(id, option, au.a.from, au.a.value, au.a.validAfter, au.a.validBefore, au.a.nonce, au.v, au.r, au.s));
};
const bal = async (u) => token.balanceOf(u.address ?? u);

console.log('\n■ 내기 1: 정상 정산 (판돈 비율 배분)');
let t = await now();
await relayFwd(alice, bets, 'create', ['토요일 경기 누가 이김?', ['한국', '일본', '무승부'], t + 3600]);
ok((await bets.getBet(1)).creator === alice.address, '앨리스가 서명만으로 내기 열기 (중계)');
await placeBet(bob, 1, 0, 30000);
await placeBet(carol, 1, 0, 10000);
await placeBet(dave, 1, 1, 60000);
ok((await bets.getBet(1)).pool === 100000n && (await bal(C.Bets)) === 100000n, '판돈 100,000 이 내기판에 보관됨 (서명 결제)');
const au0 = await signRecv(bob, C.Bets, 5000);
await expectRevert(() => bets.betWithAuthorization.staticCall(1, 0, au0.a.from, 4000n, au0.a.validAfter, au0.a.validBefore, au0.a.nonce, au0.v, au0.r, au0.s), '서명 금액과 다른 금액으로 걸기');
await expectRevert(() => bets.resolve.staticCall(1, 0), '만든 사람이 아닌 사람의 결과 입력');
await expectRevert(() => relayFwd(alice, bets, 'resolve', [1, 0]), '마감 전 결과 입력');
await warp(3601);
await expectRevert(() => placeBet(bob, 1, 0, 1000), '마감 뒤 걸기');
await relayFwd(alice, bets, 'resolve', [1, 0]);
ok((await bets.getBet(1)).state === 1n && (await bets.getBet(1)).winner === 0n, '앨리스가 결과 = 한국');
ok(await bets.claimable(1, bob.address) === 75000n && await bets.claimable(1, carol.address) === 25000n && await bets.claimable(1, dave.address) === 0n, '배당: 밥 75,000 · 캐럴 25,000 · 데이브 0');
await wait(bets.adminResolve(1, 1));
ok((await bets.getBet(1)).winner === 1n && await bets.claimable(1, dave.address) === 100000n, '관리자가 정산 전에 결과를 일본으로 정정');
await wait(bets.adminResolve(1, 0));
const b0 = await bal(bob);
await wait(bets.claimFor(1, bob.address)); // 서버(발행자)가 대신 정산
ok((await bal(bob)) === b0 + 75000n, '서버가 대신 정산 → 밥 +75,000');
await expectRevert(() => bets.claimFor.staticCall(1, bob.address), '같은 사람 두 번 정산');
await expectRevert(() => bets.adminResolve.staticCall(1, 1), '정산이 나간 뒤 결과 정정');
await expectRevert(() => bets.cancel.staticCall(1), '정산이 나간 뒤 취소');
await wait(bets.claimFor(1, carol.address));
ok((await bal(C.Bets)) === 0n, '정산 끝: 내기판 잔액 0');

console.log('\n■ 내기 2: 이긴 사람이 없으면 전원 환불');
t = await now();
await relayFwd(bob, bets, 'create', ['비 올까?', ['온다', '안 온다'], t + 600]);
await placeBet(alice, 2, 0, 2000);
await placeBet(carol, 2, 0, 3000);
await warp(601);
await relayFwd(bob, bets, 'resolve', [2, 1]);
ok(await bets.claimable(2, alice.address) === 2000n && await bets.claimable(2, carol.address) === 3000n, '이긴 쪽 판돈 0 → 건 돈 그대로 환불');

console.log('\n■ 내기 3·4: 취소');
t = await now();
await relayFwd(carol, bets, 'create', ['취소 시험', ['가', '나'], t + 600]);
await placeBet(dave, 3, 1, 4000);
await expectRevert(() => relayFwd(carol, bets, 'cancel', [3]), '판돈이 있는데 만든 사람이 취소');
await wait(bets.cancel(3));
ok((await bets.getBet(3)).state === 2n && await bets.claimable(3, dave.address) === 4000n, '관리자 취소 → 전액 환불 대상');
await relayFwd(carol, bets, 'create', ['빈 내기', ['가', '나'], t + 600]);
await relayFwd(carol, bets, 'cancel', [4]);
ok((await bets.getBet(4)).state === 2n, '판돈이 없으면 만든 사람이 취소 가능');
await expectRevert(() => relayFwd(dave, bets, 'create', ['x', ['하나'], t + 600]), '선택지 1개짜리 내기');

console.log('\n■ 쿠폰: 만들기 · 사기 · 선물 · 쓰기');
await relayFwd(alice, coupons, 'create', ['밥 한 끼 사주기권', '앨리스가 밥 삼', 'image/png', '0x89504e47', 5, 7000], 1500000);
ok(await coupons.balanceOf(1, alice.address) === 5n, '앨리스가 쿠폰 5장 만듦 (처음엔 만든 사람이 전부 보유)');
const a0 = await bal(alice);
let au = await signRecv(bob, C.Coupons, 14000);
await wait(coupons.buyWithAuthorization(1, 2, au.a.from, au.a.validAfter, au.a.validBefore, au.a.nonce, au.v, au.r, au.s));
ok(await coupons.balanceOf(1, bob.address) === 2n && (await bal(alice)) === a0 + 14000n, '밥이 서명 결제로 2장 구매 → 앨리스 +14,000');
au = await signRecv(alice, C.Coupons, 7000);
await expectRevert(() => coupons.buyWithAuthorization.staticCall(1, 1, au.a.from, au.a.validAfter, au.a.validBefore, au.a.nonce, au.v, au.r, au.s), '자기 쿠폰 사기');
await relayFwd(bob, coupons, 'gift', [carol.address, 1, 1, '생일 축하해']);
ok(await coupons.balanceOf(1, carol.address) === 1n && await coupons.balanceOf(1, bob.address) === 1n, '밥 → 캐럴 1장 선물');
await relayFwd(carol, coupons, 'redeem', [1, 1, '금요일 저녁에']);
const c1 = await coupons.getCoupon(1);
ok(await coupons.balanceOf(1, carol.address) === 0n && c1.redeemed === 1n && c1.sold === 2n, '캐럴이 1장 사용 → 사라지고 사용 기록');
await expectRevert(() => relayFwd(carol, coupons, 'redeem', [1, 1, '']), '없는 쿠폰 쓰기');
await relayFwd(alice, coupons, 'setSale', [1, 0, false]);
au = await signRecv(dave, C.Coupons, 7000);
await expectRevert(() => coupons.buyWithAuthorization.staticCall(1, 1, au.a.from, au.a.validAfter, au.a.validBefore, au.a.nonce, au.v, au.r, au.s), '판매 중지된 쿠폰 사기');

console.log(fails ? `\n실패 ${fails}건 ✘` : '\n내기판·쿠폰 점검 통과 ✅');
process.exit(fails ? 1 : 0);
