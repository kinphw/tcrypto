// 앱 시작: 설정 → 내 지갑 → (처음이면) 가입 → 탭 화면
import {
  app, api, account, loadConfig, loadNames, resumeMetaMask, connectMetaMask, hasMetaMask,
  createLocalWallet, restoreFromPhrase, sealLegacy, unlock, resumeSession, localState, savedName, rememberName, checkPw, forgetWallet, uploadVault, loginWithPassword,
  signCall, signProof, track, onSettled, html, render, $, $$, won, toast, errMsg, busy, sheet,
} from './core.js';
import home from './home.js';
import bets from './bets.js';
import { shop, coupons } from './market.js';
import me from './me.js';
import explore from './explore.js';

const TABS = [
  { id: '', title: '홈', icon: '⌂', view: home },
  { id: 'bets', title: '내기', icon: '⚑', view: bets },
  { id: 'coupons', title: '쿠폰', icon: '✦', view: coupons },
  { id: 'shop', title: '상점', icon: '▤', view: shop },
  { id: 'me', title: '나', icon: '☺', view: me },
];
// 메뉴에 없는 화면: 블록체인 보기 (#/x, #/x/addr/주소, #/x/tx/해시)
const HIDDEN = [{ id: 'x', title: '블록체인 보기', view: explore }];
const view = $('#view');

// 초대 링크(?i=닉네임)로 들어왔으면 가입할 때까지 기억
const inv = new URLSearchParams(location.search).get('i');
if (inv) { try { localStorage.setItem('tc.invite', inv); } catch {} history.replaceState(null, '', location.pathname + location.hash); }
const invite = () => { try { return localStorage.getItem('tc.invite'); } catch { return null; } };

export async function refreshMe() {
  app.me = account.address ? await api(`me/${account.address}`) : null;
  drawHeader();
  return app.me;
}

function drawHeader() {
  const m = app.me;
  render($('#top'), html`
    <a class="brand" href="#/"><span class="logo">원</span><b>수원더헤븐</b></a>
    <span class="sp"></span>
    ${m?.user ? html`<a class="pill" href="#/" title="통장 · 지갑"><span class="muted">통장</span> ${won(m.bank)}<span class="muted">원</span> <span class="dot">·</span> ${won(m.sgw)}<span class="muted">phw</span></a>` : ''}`);
}

function drawNav(active) {
  render($('#tabs'), TABS.map((t) => html`<a href="#/${t.id}" class="${t.id === active ? 'on' : ''}"><span class="ico">${t.icon}</span><span>${t.title}</span></a>`));
}

let cleanup = null;
async function route() {
  cleanup?.(); cleanup = null;
  if (!account.address) { const st = localState(); return st === 'locked' ? lockScreen() : st === 'legacy' ? legacyScreen() : onboarding(); }
  if (!app.me?.user) return onboarding();
  const [id = '', ...params] = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  const tab = TABS.find((t) => t.id === id) || HIDDEN.find((t) => t.id === id) || TABS[0];
  document.body.classList.remove('bare');
  drawNav(tab.id);
  const page = document.createElement('div');
  page.className = 'page';
  page.innerHTML = '<div class="loading"><span class="spin"></span></div>';
  view.replaceChildren(page);
  try {
    const r = await tab.view(page, params, { refreshMe, go: (h) => { location.hash = h; } });
    if (typeof r === 'function') cleanup = r;
  } catch (e) {
    console.error(e);
    render(page, html`<div class="card"><h2>화면을 그리지 못했어요</h2><p class="muted">${errMsg(e)}</p><button class="btn" onclick="location.reload()">새로고침</button></div>`);
  }
}

// ───────── 비밀번호 입력칸 ─────────
const pwFields = (confirm = true) => html`
  <label class="lbl" for="pw">비밀번호</label><input id="pw" type="password" autocomplete="${confirm ? 'new-password' : 'current-password'}" placeholder="8자 이상">
  ${confirm ? html`<input id="pw2" type="password" autocomplete="new-password" placeholder="한 번 더"><p class="hint">이 비밀번호로 계정이 잠겨요. 잊으면 12단어 백업으로만 되살릴 수 있어요.</p>` : ''}`;
function readPw(root, confirm = true) {
  const pw = $('#pw', root).value;
  checkPw(pw);
  if (confirm && pw !== $('#pw2', root).value) throw new Error('두 비밀번호가 달라요');
  return pw;
}
function bare() { document.body.classList.add('bare'); render($('#tabs'), ''); }

// ───────── 처음 오신 분: 닉네임·비밀번호 정하고 시작 ─────────
function onboarding() {
  bare();
  const r = app.cfg.rewards;
  const by = invite();
  const mm = account.kind === 'metamask'; // MetaMask 로 들어왔는데 아직 가입 안 한 사람: 닉네임만
  render(view, html`
    <div class="hero">
      <div class="hero-logo">원</div>
      <h1>수원더헤븐</h1>
      <p class="lead">친구들끼리 쓰는 가상 원화 코인 <b>박형원</b>.<br>내기하고, 쿠폰 주고받고, 가게도 열어 보세요.</p>
      ${by ? html`<div class="invited">🎁 <b>${by}</b> 님이 초대했어요 · 가입하면 둘 다 <b>${won(r.inviteReward)}원</b></div>` : ''}
      <div class="card">
        <label class="lbl" for="nick">닉네임</label>
        <input id="nick" maxlength="10" placeholder="친구들에게 보일 이름" autocomplete="username">
        <p class="hint" id="nickHint">한글·영문 10자 이내, 나중에 바꿀 수 없어요. 로그인할 때도 써요</p>
        ${mm ? '' : pwFields(true)}
        <button id="start" class="btn primary big">시작하고 ${won(r.signupBonus + (by ? r.inviteReward : 0))}원 받기</button>
      </div>
      ${mm ? '' : html`<details class="more"><summary>이미 계정이 있어요</summary>
        <div class="card">
          <button id="login" class="btn primary">닉네임 · 비밀번호로 로그인</button>
          <button id="restore" class="btn">복구 문구(12단어)로 불러오기</button>
          ${hasMetaMask() ? html`<button id="mm" class="btn">MetaMask 로 들어가기</button>` : ''}
        </div>
      </details>`}
      <p class="fine">가치 없는 가상 화폐입니다. 현금·물품으로 바꾸지 않아요.<br>모든 기록은 이더리움 시험망(${app.cfg.network.name})에 공개됩니다. 실명·연락처는 쓰지 마세요.</p>
    </div>`);
  const nick = $('#nick');
  let t;
  nick.addEventListener('input', () => {
    clearTimeout(t);
    const v = nick.value.trim();
    $('#nickHint').textContent = '한글·영문 10자 이내, 나중에 바꿀 수 없어요. 로그인할 때도 써요';
    if (!v) return;
    t = setTimeout(async () => {
      const { free } = await api(`name-free?name=${encodeURIComponent(v)}`).catch(() => ({ free: true }));
      $('#nickHint').innerHTML = free ? '<span class="ok">쓸 수 있는 닉네임이에요</span>' : '<span class="bad">이미 있는 닉네임이에요</span>';
    }, 350);
  });
  $('#start').addEventListener('click', busy($('#start'), async () => {
    const name = nick.value.trim();
    if (!name) throw new Error('닉네임을 정해 주세요');
    if (new TextEncoder().encode(name).length > 30) throw new Error('닉네임이 너무 길어요');
    const pw = mm ? null : readPw(view, true);
    const { free } = await api(`name-free?name=${encodeURIComponent(name)}`);
    if (!free) throw new Error('이미 있는 닉네임이에요');
    if (!mm) await createLocalWallet(pw);
    await join(name, pw);
  }));
  $('#login')?.addEventListener('click', loginSheet);
  $('#restore')?.addEventListener('click', restoreSheet);
  $('#mm')?.addEventListener('click', busy($('#mm'), async () => { await connectMetaMask(); await afterWallet(); }));
}

function loginSheet() {
  sheet(html`<h2>로그인</h2><p class="muted">가입할 때 정한 닉네임과 비밀번호를 넣어 주세요.</p>
    <label class="lbl" for="lnick">닉네임</label><input id="lnick" autocomplete="username" value="${savedName() || ''}">${pwFields(false)}
    <button id="go" class="btn primary big">로그인</button>
    <p class="hint">비밀번호를 잊었다면 12단어 백업으로 불러온 뒤 새 비밀번호를 정하세요.</p>`, {
    onMount: (b, close) => $('#go', b).addEventListener('click', busy($('#go', b), async () => {
      const name = $('#lnick', b).value.trim();
      if (!name) throw new Error('닉네임을 넣어 주세요');
      await loginWithPassword(name, readPw(b, false));
      close();
      await afterWallet();
    })),
  });
}

function restoreSheet() {
  sheet(html`<h2>복구 문구로 불러오기</h2><p class="muted">“나 → 백업 문구”에 있던 12단어를 띄어쓰기로 넣고, 쓸 비밀번호를 새로 정해 주세요.</p>
    <textarea id="phrase" rows="3" placeholder="단어 12개" autocomplete="off"></textarea>${pwFields(true)}
    <button id="go" class="btn primary big">불러오기</button>`, {
    onMount: (b, close) => $('#go', b).addEventListener('click', busy($('#go', b), async () => {
      const pw = readPw(b, true);
      await restoreFromPhrase($('#phrase', b).value, pw);
      close();
      await afterWallet(pw);
    })),
  });
}

// ───────── 다시 오신 분: 비밀번호로 잠금 풀기 ─────────
function lockScreen() {
  bare();
  const nm = savedName();
  render(view, html`
    <div class="hero">
      <div class="hero-logo">원</div>
      <h1>${nm ? `${nm} 님` : '수원더헤븐'}</h1>
      <p class="lead">비밀번호로 잠금을 풀어 주세요.</p>
      <form class="card" id="unlockForm">
        <input type="text" autocomplete="username" value="${nm || ''}" hidden>
        ${pwFields(false)}
        <button class="btn primary big" id="go">잠금 풀기</button>
      </form>
      <details class="more"><summary>비밀번호를 잊었거나 다른 계정이에요</summary>
        <div class="card">
          <button id="restore" class="btn">복구 문구(12단어)로 새 비밀번호 정하기</button>
          <button id="login" class="btn">다른 닉네임으로 로그인</button>
          <button id="forget" class="btn ghost danger">이 기기에서 계정 지우기</button>
        </div>
      </details>
    </div>`);
  $('#pw').focus();
  $('#unlockForm').addEventListener('submit', (e) => e.preventDefault());
  $('#go').addEventListener('click', busy($('#go'), async () => { await unlock(readPw(view, false)); await afterWallet(); }));
  $('#restore').addEventListener('click', restoreSheet);
  $('#login').addEventListener('click', loginSheet);
  $('#forget').addEventListener('click', () => {
    if (!confirm('이 기기에 저장된 계정을 지워요. 닉네임·비밀번호 로그인이나 12단어로 다시 불러올 수 있어요. 지울까요?')) return;
    forgetWallet(); onboarding();
  });
}

// ───────── 예전에 비밀번호 없이 만든 계정: 비밀번호 씌우기 ─────────
function legacyScreen() {
  bare();
  render(view, html`
    <div class="hero">
      <div class="hero-logo">원</div>
      <h1>비밀번호를 정해 주세요</h1>
      <p class="lead">이제 계정을 비밀번호로 잠가요. 이 기기의 열쇠를 이 비밀번호로 암호화하고, 다른 기기에서는 닉네임 + 비밀번호로 로그인할 수 있게 돼요.</p>
      <form class="card" id="f">${pwFields(true)}<button class="btn primary big" id="go">저장</button></form>
    </div>`);
  $('#f').addEventListener('submit', (e) => e.preventDefault());
  $('#go').addEventListener('click', busy($('#go'), async () => { const pw = readPw(view, true); await sealLegacy(pw); await afterWallet(pw); }));
}

async function join(name, pw) {
  const obj = await signCall('Members', 'join', [name], { gas: 300000, label: '가입' });
  const r = await api('join', { obj, invite: invite() });
  try { localStorage.removeItem('tc.invite'); } catch {}
  rememberName(name);
  if (pw) await uploadVault(name, pw).catch((e) => toast(`로그인 정보 저장 실패: ${errMsg(e)} — 나 → 비밀번호 바꾸기로 다시 저장하세요`, { kind: 'bad' }));
  await refreshMe();
  welcome(r.paid);
  if (r.job) track(r.job, '가입 기록');
  location.hash = '#/';
  route();
}

function welcome(paid = []) {
  const total = paid.reduce((s, p) => s + p.amount, 0);
  if (!total) return;
  sheet(html`<div class="center"><div class="big-emoji">🎉</div><h2>통장에 ${won(total)}원이 들어왔어요</h2>
    <p class="muted">이건 <b>가상 은행 통장</b>의 원화예요. 내기·쿠폰·상점에 쓰려면 <b>충전</b>해서 박형원(phw)으로 바꾸세요.<br>1원 = 1 phw, 언제든 다시 통장으로 돌려받을 수 있어요(환매).</p>
    <ul class="paid">${paid.map((p) => html`<li>${{ signup: '가입 축하금', invite: '초대 보상' }[p.kind] || p.kind} <b>+${won(p.amount)}원</b></li>`)}</ul></div>`);
}

/** 지갑이 정해진 뒤: 서버에 등록돼 있는지 보고, 명부에는 있는데 서버에 없으면 본인 확인 서명으로 등록.
 *  pw 가 있으면(새 비밀번호를 막 정함) 서버 보관함도 새 비밀번호로 맞춘다 */
async function afterWallet(pw = null) {
  await refreshMe();
  if (!app.me.user && app.names[account.address.toLowerCase()]) {
    const r = await api('join', { obj: await signProof(), invite: invite() });
    await refreshMe();
    welcome(r.paid);
  }
  if (app.me.user) {
    rememberName(app.me.user.name);
    if (pw && account.kind === 'local') await uploadVault(app.me.user.name, pw).catch(() => {});
  }
  route();
}

async function boot() {
  try {
    await loadConfig();
    await loadNames();
    if ((await resumeMetaMask().catch(() => null)) || resumeSession()) return afterWallet();
    const st = localState();
    if (st === 'locked') return lockScreen();
    if (st === 'legacy') return legacyScreen();
    route();
  } catch (e) {
    render(view, html`<div class="card"><h2>연결하지 못했어요</h2><p class="muted">${errMsg(e)}</p><button class="btn" onclick="location.reload()">다시 시도</button></div>`);
  }
}

window.addEventListener('hashchange', route);
onSettled(() => { refreshMe().then(() => { loadNames(); }).catch(() => {}); });
window.ethereum?.on?.('accountsChanged', () => location.reload());
boot();
