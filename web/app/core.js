// 청라더헤븐 앱 공용 부분: 서버 API · 내 지갑(브라우저 지갑 또는 MetaMask) · 서명 요청 만들기 · 작은 화면 도구
// 참여자는 언제나 '서명'만 한다. 블록체인에 올리고 수수료를 내는 것은 운영 서버다.
import { TYPES, forwarderDomain, tokenDomain, buildAuthorization } from '../js/core/sigs.js';

const E = () => globalThis.ethers;

// ───────── 서버 API ─────────
export async function api(path, body) {
  const r = await fetch(`/api/${path}`, {
    method: body ? 'POST' : 'GET', cache: 'no-store',
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body, (k, v) => (typeof v === 'bigint' ? v.toString() : v)) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `서버 오류 (${r.status})`);
  return j;
}

export const app = { cfg: null, names: {}, me: null };
export async function loadConfig() { app.cfg = await api('config'); return app.cfg; }
export async function loadNames() { app.names = await api('names').catch(() => app.names); return app.names; }
export const nameOf = (a) => (a ? app.names[a.toLowerCase()] || null : null);
export const addrOfName = (n) => Object.entries(app.names).find(([, v]) => v === n)?.[0] || null;

// ───────── 내 지갑 ─────────
// 기본: 이 브라우저 안에 만든 지갑. 복구 문구(12단어)를 '내 비밀번호'로 암호화해 보관한다 (MetaMask 와 같은 방식).
// 사이트를 열면 비밀번호로 잠금을 풀고, 탭을 닫으면 다시 잠긴다.
// 같은 암호문을 서버에도 맡겨 두면 다른 기기에서 닉네임 + 비밀번호로 불러올 수 있다 — 서버는 비밀번호도 열쇠도 모른다.
// 선택: MetaMask (비밀번호는 MetaMask 가 관리).
const VAULT = 'tc.vault', NAME = 'tc.name', SESS = 'tc.sess', LEGACY = 'tc.wallet';
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};
const tab = {
  get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch {} },
};
export const account = { address: null, signer: null, kind: null };

const useWallet = (w) => {
  Object.assign(account, { address: w.address, signer: w, kind: 'local' });
  tab.set(SESS, w.mnemonic.phrase); // 이 탭이 열려 있는 동안만 (새로고침해도 다시 묻지 않게)
  return account;
};
const wrongPw = () => { throw new Error('비밀번호가 맞지 않아요'); };
export const checkPw = (pw) => { if (String(pw || '').length < 8) throw new Error('비밀번호는 8자 이상으로 정해 주세요'); };
const normPhrase = (p) => p.trim().toLowerCase().split(/\s+/).join(' ');

/** 이 기기의 지갑 상태: locked(암호문 있음) · legacy(예전처럼 암호 없이 저장됨) · null(없음) */
export const localState = () => (store.get(VAULT) ? 'locked' : store.get(LEGACY) ? 'legacy' : null);
export const savedName = () => store.get(NAME);
export const rememberName = (n) => store.set(NAME, n);

/** 이 탭에서 이미 잠금을 풀었으면 그대로 */
export function resumeSession() {
  const ph = tab.get(SESS);
  if (!ph || !store.get(VAULT)) return null;
  try { return useWallet(E().Wallet.fromPhrase(ph)); } catch { return null; }
}
export async function unlock(pw) {
  const w = await E().Wallet.fromEncryptedJson(store.get(VAULT), pw).catch(wrongPw);
  return useWallet(w);
}
async function seal(w, pw) {
  checkPw(pw);
  const json = await E().encryptKeystoreJson({ address: w.address, privateKey: w.privateKey, mnemonic: w.mnemonic }, pw, { scrypt: { N: 1 << 15 } });
  store.set(VAULT, json);
  store.set(LEGACY, null);
  store.set('tc.mm', null);
  return json;
}
export async function createLocalWallet(pw) { const w = E().Wallet.createRandom(); await seal(w, pw); return useWallet(w); }
export async function restoreFromPhrase(phrase, pw) { const w = E().Wallet.fromPhrase(normPhrase(phrase)); await seal(w, pw); return useWallet(w); }
/** 예전(비밀번호 없던 때)에 만든 지갑에 비밀번호를 씌운다 */
export async function sealLegacy(pw) { const w = E().Wallet.fromPhrase(store.get(LEGACY)); await seal(w, pw); return useWallet(w); }
export async function revealPhrase(pw) { return (await E().Wallet.fromEncryptedJson(store.get(VAULT), pw).catch(wrongPw)).mnemonic.phrase; }
export function lock() { tab.set(SESS, null); Object.assign(account, { address: null, signer: null, kind: null }); }
export function forgetWallet() {
  [VAULT, LEGACY, NAME, 'tc.mm'].forEach((k) => store.set(k, null));
  tab.set(SESS, null);
  Object.assign(account, { address: null, signer: null, kind: null });
}

// ── 서버 보관함 (다른 기기에서 닉네임 + 비밀번호 로그인) ──
const authKey = (name, pw) => E().hexlify(E().scryptSync(E().toUtf8Bytes(pw), E().toUtf8Bytes(`tcrypto-login:${name}`), 1 << 14, 8, 1, 32));
const vaultMessage = (addr, vault, at) => `청라더헤븐 계정 보관\n주소: ${addr}\n암호문 지문: ${E().keccak256(E().toUtf8Bytes(vault))}\n시각: ${at}`;
export async function uploadVault(name, pw) {
  const vault = store.get(VAULT);
  const at = Math.floor(Date.now() / 1000);
  const sig = await account.signer.signMessage(vaultMessage(account.address, vault, at));
  store.set(NAME, name);
  return api('vault/save', { addr: account.address, name, auth: authKey(name, pw), vault, at, sig });
}
export async function loginWithPassword(name, pw) {
  const { vault } = await api('vault/login', { name, auth: authKey(name, pw) });
  const w = await E().Wallet.fromEncryptedJson(vault, pw).catch(wrongPw);
  store.set(VAULT, vault); store.set(NAME, name); store.set(LEGACY, null); store.set('tc.mm', null);
  return useWallet(w);
}
export async function changePassword(name, oldPw, newPw) {
  const w = await E().Wallet.fromEncryptedJson(store.get(VAULT), oldPw).catch(wrongPw);
  await seal(w, newPw);
  useWallet(w);
  if (name) await uploadVault(name, newPw);
}

export const hasMetaMask = () => !!window.ethereum;
export async function connectMetaMask() {
  if (!window.ethereum) throw new Error('MetaMask 가 없습니다');
  const [addr] = await window.ethereum.request({ method: 'eth_requestAccounts' });
  const signer = await new (E().BrowserProvider)(window.ethereum).getSigner(addr);
  Object.assign(account, { address: E().getAddress(addr), signer, kind: 'metamask' });
  store.set('tc.mm', '1');
  return account;
}
export async function resumeMetaMask() {
  if (store.get('tc.mm') !== '1' || !window.ethereum) return null;
  const [addr] = await window.ethereum.request({ method: 'eth_accounts' }).catch(() => []);
  return addr ? connectMetaMask() : null;
}

// ───────── 서명 요청 만들기 ─────────
// MetaMask 는 체인 번호가 다르면 서명을 거절하므로, 서명 직전에 세폴리아로 맞춘다
async function ensureChain() {
  if (account.kind !== 'metamask') return;
  const want = '0x' + app.cfg.network.chainId.toString(16);
  const cur = await window.ethereum.request({ method: 'eth_chainId' });
  if (cur !== want) await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: want }] });
}
const sign = async (domain, types, message) => { await ensureChain(); return account.signer.signTypedData(domain, types, message); };
const chainId = () => app.cfg.network.chainId;
const fwdDomain = () => forwarderDomain(chainId(), app.cfg.contracts.Forwarder);
const tokDomain = () => tokenDomain(chainId(), app.cfg.contracts.Seogilwon);

const ifaceCache = {};
async function iface(name) {
  if (!ifaceCache[name]) ifaceCache[name] = fetch(`/contracts/${name}.json`).then((r) => r.json()).then((a) => new (E().Interface)(a.abi));
  return ifaceCache[name];
}

/** 대납 중계 요청: 컨트랙트 함수 호출을 서명만으로 (명부·상점가·내기판·쿠폰) */
export async function signCall(contract, method, args, { gas = 600000, label } = {}) {
  const data = (await iface(contract)).encodeFunctionData(method, args);
  const { nonce } = await api(`fwd-nonce/${account.address}`);
  const req = { from: account.address, to: app.cfg.contracts[contract], value: 0n, gas: BigInt(gas), nonce: BigInt(nonce), deadline: BigInt(Math.floor(Date.now() / 1000) + 7 * 86400), data };
  const sig = await sign(fwdDomain(), { ForwardRequest: TYPES.ForwardRequest }, req);
  return { k: 'fwd', chainId: chainId(), label, req, sig };
}
/** 서길원 서명 결제·송금. k: auth(송금) · redeem(환매) · buy · bet · cbuy */
export async function signPay(k, to, value, extra = {}) {
  const kind = k === 'auth' || k === 'redeem' ? 'TransferWithAuthorization' : 'ReceiveWithAuthorization';
  const a = buildAuthorization({ from: account.address, to, value: BigInt(value), ttlDays: 1 });
  const sig = await sign(tokDomain(), { [kind]: TYPES[kind] }, a);
  return { k, chainId: chainId(), auth: a, sig, ...extra };
}
/** 충전 신청서 (블록체인 밖 서명) */
export async function signCharge(amount) {
  const n = { account: account.address, amount: BigInt(amount), memo: '가상 은행 충전', issuedAt: BigInt(Math.floor(Date.now() / 1000)) };
  return { k: 'notice', chainId: chainId(), notice: n, sig: await sign(tokDomain(), { DepositNotice: TYPES.DepositNotice }, n) };
}
/** 본인 확인 서명 (이미 명부에 이름이 있는 지갑을 서버에 등록할 때) */
export async function signProof() {
  const g = { account: account.address, issuedAt: BigInt(Math.floor(Date.now() / 1000)) };
  return { k: 'gas', chainId: chainId(), gas: g, sig: await sign(tokDomain(), { GasRequest: TYPES.GasRequest }, g) };
}

// ───────── 보내고 기다리기 ─────────
const watchers = new Set();
export const onSettled = (fn) => (watchers.add(fn), () => watchers.delete(fn));
/** 서명 봉투를 서버에 보내고, 처리될 때까지 화면 아래에 '처리 중 → 완료'를 보여 준다 */
export async function submit(obj, label) {
  const { job, duplicate } = await api('relay', { obj });
  return track(job, label || job.label, duplicate);
}
export async function track(job, label, duplicate = false) {
  if (!job) return null;
  const t = toast(`${label} — 처리 중…`, { sticky: true, spin: true });
  const until = Date.now() + 5 * 60e3;
  let j = job;
  while (j.status !== 'done' && j.status !== 'failed' && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 1500));
    j = await api(`job/${job.id}`).catch(() => j);
  }
  if (j.status === 'done') t.done(`${label} — 완료${duplicate ? ' (이미 처리된 요청)' : ''}`, 'ok');
  else if (j.status === 'failed') t.done(`${label} — 실패: ${j.error || '알 수 없는 이유'}`, 'bad', 7000);
  else t.done(`${label} — 아직 처리 중이에요. 조금 뒤 반영돼요`, '', 6000);
  // 서버 색인(목록·피드)은 블록을 읽고 몇 초 뒤에 따라오므로 한 번 더 새로 그린다
  const notify = () => watchers.forEach((f) => { try { f(j); } catch {} });
  notify();
  setTimeout(notify, 7000);
  return j;
}

// ───────── 화면 도구 ─────────
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(String(s));
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const piece = (v) => (v instanceof Raw ? v.s : Array.isArray(v) ? v.map(piece).join('') : v === false || v == null ? '' : esc(v));
export function html(strings, ...vals) { let o = strings[0]; vals.forEach((v, i) => { o += piece(v) + strings[i + 1]; }); return new Raw(o); }
export const render = (el, c) => { if (el) el.innerHTML = piece(c); return el; };
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const won = (n) => Number(n || 0).toLocaleString('ko-KR');
export const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');
export const who = (a) => nameOf(a) || short(a);
export function ago(t) {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - t));
  if (s < 60) return '방금';
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return `${Math.floor(s / 86400)}일 전`;
}
export function until(t) {
  const s = Math.floor(t - Date.now() / 1000);
  if (s <= 0) return '마감';
  if (s < 3600) return `${Math.ceil(s / 60)}분 남음`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 ${Math.floor((s % 3600) / 60)}분 남음`;
  return `${Math.floor(s / 86400)}일 남음`;
}
export const when = (t) => new Date(t * 1000).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' });

export function toast(msg, { sticky = false, spin = false, kind = '' } = {}) {
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `${spin ? '<span class="spin"></span>' : ''}<span>${esc(msg)}</span>`;
  box.appendChild(el);
  const remove = (ms) => setTimeout(() => el.remove(), ms);
  if (!sticky) remove(3500);
  return { done(m, k = '', ms = 4000) { el.className = `toast ${k}`; el.innerHTML = `<span>${esc(m)}</span>`; remove(ms); } };
}
export const errMsg = (e) => {
  const m = e?.shortMessage || e?.message || String(e);
  if (/user rejected|denied|ACTION_REJECTED/i.test(m)) return '서명을 취소했어요';
  return m;
};

/** 아래에서 올라오는 시트. 닫히면 resolve. 내용은 html`` */
export function sheet(content, { onMount } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><button class="sheet-x" aria-label="닫기">✕</button><div class="sheet-body">${piece(content)}</div></div>`;
  document.body.appendChild(wrap);
  document.body.classList.add('noscroll');
  requestAnimationFrame(() => wrap.classList.add('open'));
  let resolve;
  const closed = new Promise((r) => { resolve = r; });
  const close = (v) => { wrap.classList.remove('open'); document.body.classList.remove('noscroll'); setTimeout(() => wrap.remove(), 200); resolve(v); };
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  $('.sheet-x', wrap).addEventListener('click', () => close());
  const body = $('.sheet-body', wrap);
  onMount?.(body, close);
  return { body, close, closed };
}

/** 버튼을 누르면 잠그고 작업이 끝나면 풀기. 오류는 알림으로 */
export function busy(btn, fn) {
  return async (...a) => {
    if (btn.disabled) return;
    btn.disabled = true;
    const old = btn.innerHTML;
    btn.innerHTML = '<span class="spin"></span>';
    try { return await fn(...a); } catch (e) { toast(errMsg(e), { kind: 'bad' }); } finally { btn.disabled = false; btn.innerHTML = old; }
  };
}

/** 금액 고르기: 칩 + 직접 입력 */
export const amountPicker = (id, chips, { unit = '원', max = null } = {}) => html`
  <div class="chips">${chips.map((c) => html`<button type="button" class="chip" data-amt="${c}">${c === 'max' ? '전부' : `${won(c)}`}</button>`)}</div>
  <div class="amount"><input id="${id}" type="number" inputmode="numeric" min="1" placeholder="직접 입력" ${max != null ? raw(`max="${max}"`) : ''}><span>${unit}</span></div>`;
export function bindAmount(root, id, max = null) {
  const input = $(`#${id}`, root);
  $$('[data-amt]', root).forEach((b) => b.addEventListener('click', () => {
    input.value = b.dataset.amt === 'max' ? max ?? '' : b.dataset.amt;
    $$('[data-amt]', root).forEach((x) => x.classList.toggle('on', x === b));
    input.dispatchEvent(new Event('input'));
  }));
  return () => { const v = Math.floor(Number(input.value)); if (!(v > 0)) throw new Error('금액을 정해 주세요'); return v; };
}

/** 사진 → 24KB 이하 JPEG 바이트 (블록체인 이벤트에 담을 수 있는 크기) */
export async function shrinkImage(file, maxBytes = 22000) {
  const img = await createImageBitmap(file);
  let side = 520;
  for (let tries = 0; tries < 8; tries++) {
    const scale = Math.min(1, side / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    for (const q of [0.82, 0.7, 0.58, 0.46]) {
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', q));
      if (blob.size <= maxBytes) return { mime: 'image/jpeg', bytes: new Uint8Array(await blob.arrayBuffer()), url: URL.createObjectURL(blob) };
    }
    side = Math.round(side * 0.75);
  }
  throw new Error('사진을 충분히 줄이지 못했어요. 다른 사진으로 해 주세요');
}
export const hex = (bytes) => '0x' + [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
