// 앱 시작: 설정 → 내 지갑 → (처음이면) 가입 → 탭 화면
import {
  app, api, account, loadConfig, loadNames, loadLocalWallet, createLocalWallet, restoreLocalWallet, resumeMetaMask, connectMetaMask, hasMetaMask,
  signCall, signProof, track, onSettled, html, render, $, $$, won, toast, errMsg, busy, sheet,
} from './core.js';
import home from './home.js';
import bets from './bets.js';
import { shop, coupons } from './market.js';
import me from './me.js';

const TABS = [
  { id: '', title: '홈', icon: '⌂', view: home },
  { id: 'bets', title: '내기', icon: '⚑', view: bets },
  { id: 'coupons', title: '쿠폰', icon: '✦', view: coupons },
  { id: 'shop', title: '상점', icon: '▤', view: shop },
  { id: 'me', title: '나', icon: '☺', view: me },
];
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
    <a class="brand" href="#/"><span class="logo">원</span><b>청라더헤븐</b></a>
    <span class="sp"></span>
    ${m?.user ? html`<a class="pill" href="#/" title="통장 · 지갑"><span class="muted">통장</span> ${won(m.bank)}<span class="muted">원</span> <span class="dot">·</span> ${won(m.sgw)}<span class="muted">sgw</span></a>` : ''}`);
}

function drawNav(active) {
  render($('#tabs'), TABS.map((t) => html`<a href="#/${t.id}" class="${t.id === active ? 'on' : ''}"><span class="ico">${t.icon}</span><span>${t.title}</span></a>`));
}

let cleanup = null;
async function route() {
  cleanup?.(); cleanup = null;
  if (!app.me?.user) return onboarding();
  const [id = '', ...params] = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  const tab = TABS.find((t) => t.id === id) || TABS[0];
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

// ───────── 처음 오신 분: 닉네임 정하고 시작 ─────────
function onboarding() {
  document.body.classList.add('bare');
  render($('#tabs'), '');
  const r = app.cfg.rewards;
  const by = invite();
  render(view, html`
    <div class="hero">
      <div class="hero-logo">원</div>
      <h1>청라더헤븐</h1>
      <p class="lead">친구들끼리 쓰는 가상 원화 코인 <b>서길원</b>.<br>내기하고, 쿠폰 주고받고, 가게도 열어 보세요.</p>
      ${by ? html`<div class="invited">🎁 <b>${by}</b> 님이 초대했어요 · 가입하면 둘 다 <b>${won(r.inviteReward)}원</b></div>` : ''}
      <div class="card">
        <label class="lbl" for="nick">닉네임</label>
        <input id="nick" maxlength="10" placeholder="친구들에게 보일 이름" autocomplete="nickname">
        <p class="hint" id="nickHint">한글·영문 10자 이내, 나중에 바꿀 수 없어요</p>
        <button id="start" class="btn primary big">시작하고 ${won(r.signupBonus + (by ? r.inviteReward : 0))}원 받기</button>
      </div>
      <details class="more"><summary>이미 계정이 있어요</summary>
        <div class="card">
          <button id="restore" class="btn">복구 문구(12단어)로 불러오기</button>
          ${hasMetaMask() ? html`<button id="mm" class="btn">MetaMask 로 들어가기</button>` : ''}
        </div>
      </details>
      <p class="fine">가치 없는 가상 화폐입니다. 현금·물품으로 바꾸지 않아요.<br>모든 기록은 이더리움 시험망(${app.cfg.network.name})에 공개됩니다. 실명·연락처는 쓰지 마세요.</p>
    </div>`);
  const nick = $('#nick');
  let t;
  nick.addEventListener('input', () => {
    clearTimeout(t);
    const v = nick.value.trim();
    $('#nickHint').textContent = '한글·영문 10자 이내, 나중에 바꿀 수 없어요';
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
    if (!account.address) createLocalWallet();
    await join(name);
  }));
  $('#restore').addEventListener('click', () => {
    const s = sheet(html`<h2>복구 문구로 불러오기</h2><p class="muted">다른 기기에서 '나 → 백업'에 있던 12단어를 띄어쓰기로 넣어 주세요.</p>
      <textarea id="phrase" rows="3" placeholder="단어 12개"></textarea><button id="go" class="btn primary big">불러오기</button>`, {
      onMount: (b, close) => $('#go', b).addEventListener('click', busy($('#go', b), async () => { restoreLocalWallet($('#phrase', b).value); close(); await afterWallet(); })),
    });
    return s;
  });
  $('#mm')?.addEventListener('click', busy($('#mm'), async () => { await connectMetaMask(); await afterWallet(); }));
}

async function join(name) {
  const obj = await signCall('Members', 'join', [name], { gas: 300000, label: '가입' });
  const r = await api('join', { obj, invite: invite() });
  try { localStorage.removeItem('tc.invite'); } catch {}
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
    <p class="muted">이건 <b>가상 은행 통장</b>의 원화예요. 내기·쿠폰·상점에 쓰려면 <b>충전</b>해서 서길원(sgw)으로 바꾸세요.<br>1원 = 1 sgw, 언제든 다시 통장으로 돌려받을 수 있어요(환매).</p>
    <ul class="paid">${paid.map((p) => html`<li>${{ signup: '가입 축하금', invite: '초대 보상' }[p.kind] || p.kind} <b>+${won(p.amount)}원</b></li>`)}</ul></div>`);
}

/** 지갑이 정해진 뒤: 서버에 등록돼 있는지 보고, 명부에는 있는데 서버에 없으면 본인 확인 서명으로 등록 */
async function afterWallet() {
  await refreshMe();
  if (!app.me.user && app.names[account.address.toLowerCase()]) {
    const r = await api('join', { obj: await signProof(), invite: invite() });
    await refreshMe();
    welcome(r.paid);
  }
  route();
}

async function boot() {
  try {
    await loadConfig();
    await loadNames();
    (await resumeMetaMask().catch(() => null)) || loadLocalWallet();
    if (account.address) await afterWallet(); else route();
  } catch (e) {
    render(view, html`<div class="card"><h2>연결하지 못했어요</h2><p class="muted">${errMsg(e)}</p><button class="btn" onclick="location.reload()">다시 시도</button></div>`);
  }
}

window.addEventListener('hashchange', route);
onSettled(() => { refreshMe().then(() => { loadNames(); }).catch(() => {}); });
window.ethereum?.on?.('accountsChanged', () => location.reload());
boot();
