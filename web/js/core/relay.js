// 수수료 대납: 이용자는 MetaMask 로 '서명'만 하고(수수료 0), 대납자가 그 서명을 블록체인에 올린다.
// 서버가 없으므로 서명은 '대납 요청 링크'에 담아 카톡 등으로 전달한다. 실제 서비스는 이 심부름을 서버(릴레이어)가 자동으로 한다.
import { chain, wallet, rpc, getContract, writable, track, requireWallet } from './chain.js';
import { html, render, toast, openModal, short, won, errMsg } from './ui.js';
import { TYPES, forwarderDomain, tokenDomain, buildForwardRequest, buildAuthorization, splitSig } from './sigs.js';

const E = () => globalThis.ethers;

// ───────── 링크 인코딩 (bigint 는 문자열로) ─────────
// 카톡으로 보낼 수 있게 짧게: JSON → deflate 압축 → base64url, 앞에 'z.' 표시 (압축을 못 하는 옛 브라우저는 압축 없이)
const toB64url = (bytes) => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const pipe = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
export async function encodeRelay(obj) {
  const raw = new TextEncoder().encode(JSON.stringify(obj, (k, v) => (typeof v === 'bigint' ? v.toString() : v)));
  const payload = typeof CompressionStream === 'function' ? 'z.' + toB64url(await pipe(raw, new CompressionStream('deflate-raw'))) : toB64url(raw);
  return `${location.origin}${location.pathname}${location.search}#/relay/${payload}`;
}
export async function decodeRelay(payload) {
  const z = payload.startsWith('z.');
  const bytes = fromB64url(z ? payload.slice(2) : payload);
  return JSON.parse(new TextDecoder().decode(z ? await pipe(bytes, new DecompressionStream('deflate-raw')) : bytes));
}

// ───────── 수수료 방식: 'direct'(내가 ETH 로 냄) / 'gasless'(서명만, 대납 요청) ─────────
const MODE_KEY = 'tcrypto.feeMode';
export function getFeePref() { try { return localStorage.getItem(MODE_KEY) || 'auto'; } catch { return 'auto'; } }
export function setFeePref(m) { try { localStorage.setItem(MODE_KEY, m); } catch {} }
export async function feeMode() {
  const pref = getFeePref();
  if (pref !== 'auto') return pref;
  if (!wallet.address) return 'gasless';
  const bal = await chain.provider.getBalance(wallet.address);
  return bal > E().parseEther('0.0005') ? 'direct' : 'gasless';
}

const domainOf = {
  fwd: () => forwarderDomain(chain.cfg.network.chainId, chain.cfg.contracts.Forwarder),
  token: () => tokenDomain(chain.cfg.network.chainId, chain.cfg.contracts.Seogilwon),
};

// ───────── 서명 만들기 ─────────
/** 명부·상점가·코인공장·친구코인의 함수를 대납 중계 요청으로 서명 */
export async function signForward(target, method, args, label) {
  const signer = requireWallet();
  const forwarder = await getContract('Forwarder');
  const to = await target.getAddress();
  const data = target.interface.encodeFunctionData(method, args);
  // 중계기가 끝에 붙일 '요청자 주소'까지 넣어 실제 실행 가스를 미리 계산 (대납자가 이만큼 가스를 붙여 보냄)
  let gas;
  try {
    gas = BigInt(await rpc('eth_estimateGas', [{ from: chain.cfg.contracts.Forwarder, to, data: data + wallet.address.slice(2).toLowerCase() }]));
  } catch (e) {
    throw new Error(`이 요청은 지금 실행하면 거절됩니다: ${errMsg(e)}`);
  }
  gas = (gas * 13n) / 10n + 30000n;
  const req = await buildForwardRequest({ forwarder, from: wallet.address, to, data, gas });
  const sig = await signer.signTypedData(domainOf.fwd(), { ForwardRequest: TYPES.ForwardRequest }, req);
  return { k: 'fwd', chainId: chain.cfg.network.chainId, label, method, req, sig };
}

/** 서길원 서명 송금 (EIP-3009 transferWithAuthorization) */
export async function signTransfer(to, value, label) {
  const signer = requireWallet();
  const auth = buildAuthorization({ from: wallet.address, to, value });
  const sig = await signer.signTypedData(domainOf.token(), { TransferWithAuthorization: TYPES.TransferWithAuthorization }, auth);
  return { k: 'auth', chainId: chain.cfg.network.chainId, label, auth, sig };
}

/** 상점 서명 결제 (EIP-3009 receiveWithAuthorization → Market.buyWithAuthorization) */
export async function signBuy(productId, quantity, note, total, label) {
  const signer = requireWallet();
  const auth = buildAuthorization({ from: wallet.address, to: chain.cfg.contracts.Market, value: total });
  const sig = await signer.signTypedData(domainOf.token(), { ReceiveWithAuthorization: TYPES.ReceiveWithAuthorization }, auth);
  return { k: 'buy', chainId: chain.cfg.network.chainId, label, productId: Number(productId), quantity: Number(quantity), note, auth, sig };
}

/** 입금 신고서 (블록체인에 올라가지 않음 — 발행자가 확인하고 발행) */
export async function signNotice(amount, memo) {
  const signer = requireWallet();
  const notice = { account: wallet.address, amount: BigInt(amount), memo, issuedAt: BigInt(Math.floor(Date.now() / 1000)) };
  const sig = await signer.signTypedData(domainOf.token(), { DepositNotice: TYPES.DepositNotice }, notice);
  return { k: 'notice', chainId: chain.cfg.network.chainId, label: `입금 신고 ${won(amount)}`, notice, sig };
}

// ───────── 검증 · 설명 ─────────
const big = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'string' && /^\d+$/.test(v) ? BigInt(v) : v]));
export function relayParts(obj) {
  if (obj.k === 'fwd') return { domain: domainOf.fwd(), types: { ForwardRequest: TYPES.ForwardRequest }, message: big(obj.req), expected: obj.req.from };
  if (obj.k === 'auth') return { domain: domainOf.token(), types: { TransferWithAuthorization: TYPES.TransferWithAuthorization }, message: big(obj.auth), expected: obj.auth.from };
  if (obj.k === 'buy') return { domain: domainOf.token(), types: { ReceiveWithAuthorization: TYPES.ReceiveWithAuthorization }, message: big(obj.auth), expected: obj.auth.from };
  if (obj.k === 'notice') return { domain: domainOf.token(), types: { DepositNotice: TYPES.DepositNotice }, message: big(obj.notice), expected: obj.notice.account };
  throw new Error('알 수 없는 요청 종류');
}

/** 이 브라우저에서 서명자 복원 — 대납자가 내용을 바꿨다면 여기서 드러난다 */
export function verifyRelay(obj) {
  const p = relayParts(obj);
  const signer = E().verifyTypedData(p.domain, p.types, p.message, obj.sig);
  const digest = E().TypedDataEncoder.hash(p.domain, p.types, p.message);
  return { signer, ok: signer.toLowerCase() === p.expected.toLowerCase(), digest, ...p };
}

// ───────── 대납 실행 (수수료는 지금 연결된 지갑이 냄) ─────────
export async function submitRelay(obj) {
  requireWallet();
  if (obj.chainId !== chain.cfg.network.chainId) throw new Error('다른 네트워크용 요청입니다');
  if (obj.k === 'fwd') {
    const f = await writable(await getContract('Forwarder'));
    const req = big(obj.req);
    return track(f.execute(req, obj.sig, { gasLimit: req.gas + 120000n }), `대납: ${obj.label}`);
  }
  const s = splitSig(obj.sig);
  if (obj.k === 'auth') {
    const t = await writable(await getContract('Seogilwon'));
    const a = big(obj.auth);
    return track(t.transferWithAuthorization(a.from, a.to, a.value, a.validAfter, a.validBefore, a.nonce, s.v, s.r, s.s), `대납: ${obj.label}`);
  }
  if (obj.k === 'buy') {
    const m = await writable(await getContract('Market'));
    const a = big(obj.auth);
    return track(m.buyWithAuthorization(obj.productId, obj.quantity, obj.note || '', a.from, a.validAfter, a.validBefore, a.nonce, s.v, s.r, s.s), `대납: ${obj.label}`);
  }
  throw new Error('이 요청은 대납이 아니라 발행자 확인이 필요합니다');
}

// ───────── 서명 후 화면: 링크 공유 ─────────
export async function showRelayLink(obj, { to = '발행자(또는 ETH 가 있는 참여자)' } = {}) {
  const link = await encodeRelay(obj);
  const notice = obj.k === 'notice';
  const close = openModal(html`
    <h2>서명 완료 — 아직 블록체인에는 아무 일도 없습니다</h2>
    ${notice
      ? html`<p class="small">방금 MetaMask 에서 한 것은 <b>거래가 아니라 서명</b>이라 수수료가 들지 않았어요. 입금 신고서는 블록체인에 올라가지 않습니다.
          아래 링크를 <b>${to}</b>에게 보내 주세요. 발행자가 입금을 확인하면 그 금액만큼 서길원을 발행해 줍니다.</p>`
      : html`<p class="small">방금 MetaMask 에서 한 것은 <b>거래가 아니라 서명</b>이라 수수료가 들지 않았어요. 이 서명을 누군가 블록체인에 올려야 실제로 실행됩니다.
          아래 링크를 <b>${to}</b>에게 보내 주세요. 링크를 연 사람이 수수료를 내고 대신 올립니다.</p>`}
    <div class="verify"><div class="vtitle">${obj.label}</div><div class="small hash break" style="margin-top:6px">${short(link, 60, 20)}</div></div>
    <div class="row" style="margin-top:10px">
      <button class="btn btn-primary" id="rlCopy">링크 복사</button>
      ${navigator.share ? html`<button class="btn" id="rlShare">공유하기</button>` : ''}
      <a class="btn btn-ghost" href="${link}" id="rlOpen">직접 열어 보기</a>
    </div>
    <p class="small muted" style="margin-top:10px">${notice
      ? '링크 안에는 신고 내용(누가, 얼마, 언제)과 서명값만 들어 있습니다. 서명이 있어서 발행자는 이 신고를 정말 이 지갑 주인이 했는지 확인할 수 있습니다.'
      : '링크 안에는 서명 내용(누가, 무엇을, 언제까지)과 서명값만 들어 있습니다. 대납자는 내용을 바꿀 수 없고(바꾸면 서명이 깨짐), 할 수 있는 것은 올리느냐 마느냐뿐입니다. 유효기간은 7일입니다.'}</p>`);
  document.getElementById('rlCopy').addEventListener('click', () => navigator.clipboard?.writeText(link).then(() => toast('복사했습니다. 카톡 등에 붙여넣어 보내세요.')).catch(() => prompt('복사하세요', link)));
  document.getElementById('rlShare')?.addEventListener('click', () => navigator.share({ title: '청라더헤븐 대납 요청', text: obj.label, url: link }).catch(() => {}));
  document.getElementById('rlOpen').addEventListener('click', () => close());
  return link;
}

/**
 * 행동 하나를 '수수료 방식'에 맞춰 실행.
 *  direct : () => 거래 Promise (내가 ETH 로 수수료)
 *  gasless: () => 서명 객체 (대납 요청 링크)
 */
export async function perform({ direct, gasless, label }) {
  const mode = await feeMode();
  if (mode === 'direct' && direct) return { mode, receipt: await track(direct(), label) };
  if (!gasless) throw new Error('이 기능은 대납을 지원하지 않습니다. 수수료용 ETH 가 필요합니다.');
  const obj = await gasless();
  await showRelayLink(obj);
  return { mode: 'gasless', obj };
}
