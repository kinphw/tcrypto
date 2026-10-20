// 수수료 대납: 이용자는 MetaMask 로 '서명'만 하고(수수료 0), 대납자가 그 서명을 블록체인에 올린다.
// 서명은 공개 요청함(core/inbox.js)에 자동으로 넣고, 요청함이 안 되면 '대납 요청 링크'로 카톡 등에 전달한다.
// 실제 서비스는 이 심부름을 회사 서버(릴레이어)가 자동으로 한다.
import { chain, wallet, rpc, getContract, writable, track, requireWallet } from './chain.js';
import { html, render, toast, openModal, short, won, errMsg } from './ui.js';
import { postRequest, requestStatus, KEEP_HOURS } from './inbox.js';
import { TYPES, forwarderDomain, tokenDomain, buildForwardRequest, buildAuthorization, splitSig } from './sigs.js';
import * as kit from './relaykit.js';

const { big } = kit;

const E = () => globalThis.ethers;

// ───────── 링크 인코딩 (bigint 는 문자열로) ─────────
// 카톡으로 보낼 수 있게 짧게: JSON → deflate 압축 → base64url, 앞에 'z.' 표시 (압축을 못 하는 옛 브라우저는 압축 없이)
const toB64url = (bytes) => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const pipe = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
export async function encodePayload(obj) {
  const raw = new TextEncoder().encode(JSON.stringify(obj, (k, v) => (typeof v === 'bigint' ? v.toString() : v)));
  return typeof CompressionStream === 'function' ? 'z.' + toB64url(await pipe(raw, new CompressionStream('deflate-raw'))) : toB64url(raw);
}
export const relayLink = (payload) => `${location.origin}${location.pathname}${location.search}#/relay/${payload}`;
export async function encodeRelay(obj) {
  return relayLink(await encodePayload(obj));
}
export async function decodePayload(payload) {
  const z = payload.startsWith('z.');
  const bytes = fromB64url(z ? payload.slice(2) : payload);
  return JSON.parse(new TextDecoder().decode(z ? await pipe(bytes, new DecompressionStream('deflate-raw')) : bytes));
}
export const decodeRelay = decodePayload;

// ───────── 수수료: 참여자는 언제나 서명만 하고, 수수료는 발행사(자동 처리기)가 낸다 ─────────
// 실제 스테이블코인 이용자처럼 참여자는 토큰만 쓴다. 직접 내는 선택지는 두지 않는다.
export const feeMode = async () => 'gasless';

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

/** 입금 신청서 (블록체인에 올라가지 않음 — 발행자가 확인하고 발행) */
export async function signNotice(amount, memo) {
  const signer = requireWallet();
  const notice = { account: wallet.address, amount: BigInt(amount), memo, issuedAt: BigInt(Math.floor(Date.now() / 1000)) };
  const sig = await signer.signTypedData(domainOf.token(), { DepositNotice: TYPES.DepositNotice }, notice);
  return { k: 'notice', chainId: chain.cfg.network.chainId, label: `입금 신청 ${won(amount)}`, notice, sig };
}

/** 수수료용 ETH 요청서 (블록체인에 올라가지 않음 — 발행자가 보고 ETH 를 보내 줌) */
export async function signGasRequest() {
  const signer = requireWallet();
  const gas = { account: wallet.address, issuedAt: BigInt(Math.floor(Date.now() / 1000)) };
  const sig = await signer.signTypedData(domainOf.token(), { GasRequest: TYPES.GasRequest }, gas);
  return { k: 'gas', chainId: chain.cfg.network.chainId, label: '수수료용 ETH 요청', gas, sig };
}
export const GAS_GIFT = '0.005';

// ───────── 검증 · 설명 (운영 서버와 같은 코드: core/relaykit.js) ─────────
export const relayParts = (obj) => kit.relayParts(obj, chain.cfg);
/** 이 브라우저에서 서명자 복원 — 대납자가 내용을 바꿨다면 여기서 드러난다 */
export const verifyRelay = (obj) => kit.verifyRelay(obj, chain.cfg);

// ───────── 대납 실행 (수수료는 지금 연결된 지갑이 냄) ─────────
/** signer 를 주면 그 지갑(자동 처리기)이, 안 주면 연결된 MetaMask 가 수수료를 내고 올린다 */
export async function submitRelay(obj, signer) {
  if (!signer) requireWallet();
  if (obj.chainId !== chain.cfg.network.chainId) throw new Error('다른 네트워크용 요청입니다');
  if (obj.k === 'fwd') {
    const f = await writable(await getContract('Forwarder'), signer);
    const req = big(obj.req);
    return track(f.execute(req, obj.sig, { gasLimit: req.gas + 120000n }), `대납: ${obj.label}`, { quiet: !!signer });
  }
  const s = splitSig(obj.sig);
  if (obj.k === 'auth') {
    const t = await writable(await getContract('Seogilwon'), signer);
    const a = big(obj.auth);
    return track(t.transferWithAuthorization(a.from, a.to, a.value, a.validAfter, a.validBefore, a.nonce, s.v, s.r, s.s), `대납: ${obj.label}`, { quiet: !!signer });
  }
  if (obj.k === 'buy') {
    const m = await writable(await getContract('Market'), signer);
    const a = big(obj.auth);
    return track(m.buyWithAuthorization(obj.productId, obj.quantity, obj.note || '', a.from, a.validAfter, a.validBefore, a.nonce, s.v, s.r, s.s), `대납: ${obj.label}`, { quiet: !!signer });
  }
  if (obj.k === 'gas') {
    const tx = await requireWallet().sendTransaction({ to: obj.gas.account, value: E().parseEther(GAS_GIFT) });
    return track(Promise.resolve(tx), `수수료용 ETH ${GAS_GIFT} 보내기`);
  }
  throw new Error('이 요청은 대납이 아니라 발행자 확인이 필요합니다');
}

/** 입금 신청서 승인 → 발행. 발행 메모에 신청서 지문을 남겨 같은 신청서로 두 번 발행하지 못하게 한다 */
export async function approveNotice(obj, signer, { auto = false } = {}) {
  const v = verifyRelay(obj);
  if (!v.ok) throw new Error('서명이 맞지 않는 신청서입니다');
  const t = await writable(await getContract('Seogilwon'), signer);
  return track(t.mint(obj.notice.account, BigInt(obj.notice.amount), `입금 신청 ${v.digest} 확인${auto ? ' (자동)' : ''}`), '발행', { quiet: !!signer });
}

// ───────── 서명 후: 처리될 때까지 지켜보다가 '완료' 알림 + 화면 새로 그림 ─────────
const WATCH_MS = 15 * 60 * 1000; // 처리기가 잠깐 멈춰 있어도 기다렸다가 반영
async function watchUntilDone(obj) {
  const v = verifyRelay(obj);
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = `${obj.label} — 처리 중… (보통 1분 안에)`;
  box?.appendChild(el);
  const until = Date.now() + WATCH_MS;
  while (Date.now() < until) {
    // 처음 2분은 4초마다, 그 뒤는 15초마다 확인
    await new Promise((r) => setTimeout(r, Date.now() < until - WATCH_MS + 120000 ? 4000 : 15000));
    const st = await requestStatus(obj, v).catch(() => null);
    if (st?.[0] === 'used') {
      el.className = 'toast ok';
      el.textContent = `완료 — ${obj.label}`;
      setTimeout(() => el.remove(), 5000);
      window.dispatchEvent(new HashChangeEvent('hashchange')); // 지금 화면을 새로 그려 잔액 등 반영
      return;
    }
    if (st?.[0] === 'expired') break;
  }
  el.textContent = `${obj.label} — 아직 처리 대기 중이에요. 발행사 처리기가 켜지면 반영됩니다.`;
  setTimeout(() => el.remove(), 8000);
}

// ───────── 요청함에 못 넣었을 때만: 링크로 보내기 ─────────
export async function showRelayLink(obj, { to = '발행자(또는 ETH 가 있는 참여자)' } = {}) {
  const payload = await encodePayload(obj);
  const link = relayLink(payload);
  const offchain = obj.k === 'notice' || obj.k === 'gas';
  // 1) 공개 요청함에 자동으로 넣기 (실제 서비스의 '앱 → 회사 서버' 단계)
  let posted = null;
  let postErr = null;
  try { posted = await postRequest(obj); } catch (e) { postErr = errMsg(e); }
  // 요청함에 들어갔으면 팝업 없이 '처리 중 → 완료'만 보여 줌 (실제 앱처럼)
  if (posted) { watchUntilDone(obj); return link; }

  const what = obj.k === 'notice' ? '발행자가 입금을 확인하면 그 금액만큼 서길원을 발행해 줍니다.'
    : obj.k === 'gas' ? '발행자가 보면 수수료용 ETH 를 보내 줍니다.'
    : '발행자(또는 ETH 가 있는 누구든)가 수수료를 내고 올려 주면 실행됩니다.';
  const close = openModal(html`
    <h2>${posted ? '요청을 보냈습니다' : '서명 완료 — 링크를 보내 주세요'}</h2>
    <p class="small">방금 MetaMask 에서 한 것은 <b>거래가 아니라 서명</b>이라 수수료가 들지 않았어요. ${offchain ? '이 서명은 블록체인에 올라가지 않습니다.' : '아직 블록체인에는 아무 일도 없습니다.'}</p>
    <div class="verify ${posted ? 'ok' : ''}"><div class="vtitle">${obj.label}</div>
      ${posted
        ? html`<p class="small" style="margin-top:6px">✓ <b>공개 요청함</b>에 넣었습니다. ${what} 따로 연락할 필요 없어요.</p>`
        : html`<p class="small" style="margin-top:6px">요청함에 넣지 못했습니다 (${postErr}). 아래 링크를 <b>${to}</b>에게 카톡 등으로 보내 주세요. ${what}</p>`}
    </div>
    <div class="row" style="margin-top:10px">
      ${posted ? html`<a class="btn btn-primary" href="#/inbox" id="rlInbox">요청함에서 보기</a>` : ''}
      <button class="btn ${posted ? '' : 'btn-primary'}" id="rlCopy">링크 복사${posted ? ' (예비용)' : ''}</button>
      ${navigator.share ? html`<button class="btn" id="rlShare">공유하기</button>` : ''}
    </div>
    <p class="small muted" style="margin-top:10px">요청함과 링크에는 서명 내용(누가, 무엇을, 언제까지)과 서명값만 들어 있습니다. 누구나 볼 수 있지만 내용을 바꾸면 서명이 깨지므로, 올리는 사람이 할 수 있는 것은 올리느냐 마느냐뿐입니다.
      ${offchain ? '' : '유효기간은 7일, '}요청함 보관은 ${KEEP_HOURS}시간입니다.</p>`);
  document.getElementById('rlCopy').addEventListener('click', () => navigator.clipboard?.writeText(link).then(() => toast('복사했습니다. 카톡 등에 붙여넣어 보내세요.')).catch(() => prompt('복사하세요', link)));
  document.getElementById('rlShare')?.addEventListener('click', () => navigator.share({ title: '청라더헤븐 대납 요청', text: obj.label, url: link }).catch(() => {}));
  document.getElementById('rlInbox')?.addEventListener('click', () => close());
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
