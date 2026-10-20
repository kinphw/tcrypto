// 박형원(USDC 방식) 전체 기능 자동 점검 — 로컬 시험망(anvil 등)에서 실행.
//   node tools-js/stable-test.mjs <rpcUrl> <발행자 개인키>
// 친구 지갑(앨리스·밥·캐럴)은 새로 만든 지갑이라 ETH 가 0 이다. 모든 행동을 '서명 → 발행자가 대납'으로 처리해
// "ETH 없이도 박형원을 쓸 수 있다"를 확인한다.
import { ethers } from 'ethers';
import { deployAll, art } from './deploy-lib.mjs';

globalThis.ethers = ethers;
const S = await import('../web/js/core/sigs.js');
const [rpcUrl, pk] = process.argv.slice(2);
const p = new ethers.JsonRpcProvider(rpcUrl, undefined, { pollingInterval: 300 });
const issuer = new ethers.NonceManager(new ethers.Wallet(pk, p));
const [alice, bob, carol] = [1, 2, 3].map(() => ethers.Wallet.createRandom().connect(p));
const chainId = Number((await p.getNetwork()).chainId);
let fails = 0;
const ok = (c, m) => { console.log(c ? '  ✔' : '  ✘', m); if (!c) fails++; };
const expectRevert = async (fn, m) => { try { await fn(); ok(false, `${m} (거절돼야 하는데 통과)`); } catch (e) { ok(true, `${m} → 거절: ${e.reason || e.shortMessage}`); } };
const wait = async (txp) => (await txp).wait();

console.log('■ 배포');
const C = await deployAll(issuer, () => {});
Object.entries(C).forEach(([k, v]) => console.log(`  · ${k.padEnd(12)} ${v}`));
const V1 = art('SeogilwonV1');
const token = new ethers.Contract(C.Seogilwon, V1.abi, issuer);
const fwd = new ethers.Contract(C.Forwarder, art('Forwarder').abi, issuer);
const members = new ethers.Contract(C.Members, art('Members').abi, issuer);
const market = new ethers.Contract(C.Market, art('Market').abi, issuer);
const factory = new ethers.Contract(C.CoinFactory, art('CoinFactory').abi, issuer);
const proxy = new ethers.Contract(C.Seogilwon, art('SgwProxy').abi, issuer);

console.log('\n■ 프록시 구조');
ok(await token.name() === '박형원' && await token.symbol() === 'phw' && await token.currency() === 'KRW', `토큰 정보: ${await token.name()} / ${await token.symbol()} / ${await token.currency()}`);
ok(await token.implementationVersion() === '1', '구현 판: 1');
ok((await proxy.proxyImplementation()) === C.SeogilwonV1, '프록시가 가리키는 구현 = V1');
const implSlot = await p.getStorage(C.Seogilwon, '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc');
ok(ethers.getAddress('0x' + implSlot.slice(26)) === C.SeogilwonV1, 'EIP-1967 구현 칸에 V1 주소가 적혀 있음');
await expectRevert(() => new ethers.Contract(C.SeogilwonV1, V1.abi, issuer).initialize.staticCall('x', 'x', 'x', 0, issuer.signer.address), '구현 컨트랙트 직접 초기화');

// 대납 도우미: 친구가 서명 → 발행자가 execute
const relayFwd = async (user, target, fn, args, gas = 600000) => {
  const data = target.interface.encodeFunctionData(fn, args);
  const req = await S.buildForwardRequest({ forwarder: fwd, from: user.address, to: await target.getAddress(), data, gas });
  const sig = await user.signTypedData(S.forwarderDomain(chainId, C.Forwarder), { ForwardRequest: S.TYPES.ForwardRequest }, req);
  return wait(fwd.execute(req, sig));
};
const signAuth = async (user, kind, to, value) => {
  const a = S.buildAuthorization({ from: user.address, to, value });
  const sig = await user.signTypedData(S.tokenDomain(chainId, C.Seogilwon), { [kind]: S.TYPES[kind] }, a);
  return { a, ...S.splitSig(sig) };
};

console.log('\n■ ETH 없는 친구들의 가입 (대납 중계)');
ok((await p.getBalance(alice.address)) === 0n, '앨리스 ETH 잔액 0');
await relayFwd(alice, members, 'join', ['앨리스']);
await relayFwd(bob, members, 'join', ['밥']);
ok(await members.nameOf(alice.address) === '앨리스' && await members.nameOf(bob.address) === '밥', '서명만으로 가입 완료 (수수료는 발행자)');
ok((await p.getBalance(alice.address)) === 0n, '앨리스 ETH 여전히 0');

console.log('\n■ 발행 한도');
ok(await token.minterAllowance(issuer.signer.address) === 100_000_000n, '발행자 한도 1억 sgw');
// 입금 신고서 서명(블록체인 밖) → 발행자가 서명자 확인 후 발행
const notice = { account: alice.address, amount: 50000n, memo: '입금자 앨리스', issuedAt: BigInt(Math.floor(Date.now() / 1000)) };
const nsig = await alice.signTypedData(S.tokenDomain(chainId, C.Seogilwon), { DepositNotice: S.TYPES.DepositNotice }, notice);
ok(ethers.verifyTypedData(S.tokenDomain(chainId, C.Seogilwon), { DepositNotice: S.TYPES.DepositNotice }, notice, nsig) === alice.address, '입금 신고서 서명자 = 앨리스');
await wait(token.mint(alice.address, 50000, '입금 신고 확인'));
await wait(token.mint(bob.address, 20000, '입금 신고 확인'));
ok(await token.balanceOf(alice.address) === 50000n && await token.minterAllowance(issuer.signer.address) === 100_000_000n - 70000n, '발행 후 잔액·한도 차감');
await wait(token.configureMinter(carol.address, 10)); // 캐럴을 한도 10 짜리 발행 담당으로 (ETH 없으니 시험만)
ok(await token.isMinter(carol.address) && await token.minterAllowance(carol.address) === 10n, '발행 담당 추가 (한도 10)');
await wait(token.removeMinter(carol.address));
ok(!(await token.isMinter(carol.address)), '발행 담당 해제');

console.log('\n■ 서명 송금 (EIP-3009)');
let au = await signAuth(alice, 'TransferWithAuthorization', bob.address, 1500);
await wait(token.transferWithAuthorization(au.a.from, au.a.to, au.a.value, au.a.validAfter, au.a.validBefore, au.a.nonce, au.v, au.r, au.s));
ok(await token.balanceOf(alice.address) === 48500n && await token.balanceOf(bob.address) === 21500n, '앨리스 → 밥 1,500 (앨리스 서명, 발행자 대납)');
ok(await token.authorizationState(alice.address, au.a.nonce), '사용한 서명 번호 기록됨');
await expectRevert(() => token.transferWithAuthorization.staticCall(au.a.from, au.a.to, au.a.value, au.a.validAfter, au.a.validBefore, au.a.nonce, au.v, au.r, au.s), '같은 서명 재사용');

console.log('\n■ 서명 결제 허용 (EIP-2612 permit)');
const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
const permit = { owner: alice.address, spender: C.Market, value: 1000n, nonce: await token.nonces(alice.address), deadline };
const ps = S.splitSig(await alice.signTypedData(S.tokenDomain(chainId, C.Seogilwon), { Permit: S.TYPES.Permit }, permit));
await wait(token.permit(alice.address, C.Market, 1000, deadline, ps.v, ps.r, ps.s));
ok(await token.allowance(alice.address, C.Market) === 1000n, '앨리스 → 상점가 1,000 허용 (서명만)');

console.log('\n■ 상점 (대납 중계 + 서명 결제)');
await relayFwd(bob, market, 'openShop', ['밥네 떡볶이', '맵게']);
await relayFwd(bob, market, 'listProduct', [1, '떡볶이 1인분', '가상 상품', 3000, 10, '', '0x']);
const shop = await market.getShop(1);
ok(shop.owner === bob.address, '상점 주인 = 밥 (중계기를 거쳐도 진짜 요청자가 기록됨)');
au = await signAuth(alice, 'ReceiveWithAuthorization', C.Market, 6000);
await wait(market.buyWithAuthorization(1, 2, '덜 맵게', au.a.from, au.a.validAfter, au.a.validBefore, au.a.nonce, au.v, au.r, au.s));
ok(await token.balanceOf(bob.address) === 27500n && (await market.getProduct(1)).stock === 8n, '앨리스 서명 결제로 2개 구매 → 밥 +6,000, 재고 8');
const bad = await signAuth(alice, 'ReceiveWithAuthorization', C.Market, 1000); // 금액이 총액과 다른 서명
await expectRevert(() => market.buyWithAuthorization.staticCall(1, 2, '', bad.a.from, bad.a.validAfter, bad.a.validBefore, bad.a.nonce, bad.v, bad.r, bad.s), '총액과 다른 금액의 결제 서명');

console.log('\n■ 상환 (발행사 주소로 보내고 → 발행자가 소각)');
au = await signAuth(alice, 'TransferWithAuthorization', issuer.signer.address, 1000);
await wait(token.transferWithAuthorization(au.a.from, au.a.to, au.a.value, au.a.validAfter, au.a.validBefore, au.a.nonce, au.v, au.r, au.s));
const supplyBefore = await token.totalSupply();
await wait(token.burn(1000, '앨리스 상환'));
ok(await token.totalSupply() === supplyBefore - 1000n, '상환 소각으로 총발행 −1,000');

console.log('\n■ 블랙리스트 · 일시정지');
await wait(token.mint(carol.address, 777, '시험'));
await wait(token.blacklist(carol.address, '수사기관 요청 (시험)'));
au = await signAuth(carol, 'TransferWithAuthorization', bob.address, 1);
await expectRevert(() => token.transferWithAuthorization.staticCall(au.a.from, au.a.to, au.a.value, au.a.validAfter, au.a.validBefore, au.a.nonce, au.v, au.r, au.s), '블랙리스트 계좌의 송금');
await wait(token.destroyBlackFunds(carol.address, '법원 몰수 명령 (시험)'));
ok(await token.balanceOf(carol.address) === 0n, '블랙리스트 자금 소각');
await wait(token.pause('긴급 점검'));
au = await signAuth(alice, 'TransferWithAuthorization', bob.address, 1);
await expectRevert(() => token.transferWithAuthorization.staticCall(au.a.from, au.a.to, au.a.value, au.a.validAfter, au.a.validBefore, au.a.nonce, au.v, au.r, au.s), '일시정지 중 송금');
await wait(token.unpause('정상화'));
await wait(token.attestReserve(await token.totalSupply(), '10월 가상 잔고 증명'));
ok(await token.attestationCount() === 1n, '준비금 공시');

console.log('\n■ 친구 코인 (대납 중계)');
await relayFwd(alice, factory, 'createCoin', ['앨리스포인트', 'ALP', 1000], 1500000);
const coinAddr = (await factory.allCoins())[0];
const fc = new ethers.Contract(coinAddr, art('FriendCoin').abi, issuer);
ok(await fc.issuer() === alice.address && await fc.balanceOf(alice.address) === 1000n, '앨리스가 서명만으로 코인 창조');
await relayFwd(alice, fc, 'transferWithMemo', [bob.address, 100, '선물']);
ok(await fc.balanceOf(bob.address) === 100n, '친구 코인 서명 송금');

console.log('\n■ 업그레이드 (V1 → V2)');
const balBefore = await token.balanceOf(alice.address);
const v2 = await (await new ethers.ContractFactory(art('SeogilwonV2').abi, art('SeogilwonV2').bytecode, issuer).deploy()).waitForDeployment();
await expectRevert(() => proxy.connect(alice).upgradeTo.staticCall(v2.target), '관리자가 아닌 사람의 업그레이드');
await wait(proxy.upgradeTo(v2.target));
const tokenV2 = new ethers.Contract(C.Seogilwon, art('SeogilwonV2').abi, issuer);
ok(await tokenV2.implementationVersion() === '2', '같은 주소, 구현 판 2');
ok(await tokenV2.balanceOf(alice.address) === balBefore, `잔액 그대로 (앨리스 ${balBefore})`);
await wait(tokenV2.clawback(alice.address, 500, 'V2 새 권한 시험'));
ok(await tokenV2.balanceOf(alice.address) === balBefore - 500n, 'V2 에서 생긴 새 권한(clawback)으로 블랙리스트 없이 회수');

console.log(fails ? `\n실패 ${fails}건 ✘` : '\n박형원 전 기능 점검 통과 ✅');
process.exit(fails ? 1 : 0);
