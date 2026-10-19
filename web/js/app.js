// 앱 진입점: 설정 읽기 → 공개 노드 연결 → MetaMask 상태 확인 → 주소(#/...)에 맞는 화면 표시
import { MODULES } from './modules/index.js';
import { chain, initChain, startPolling, onBlock, onStatus, onRpc, wallet, onWallet, initWallet, connectWallet, switchNetwork, rpc, loadMembers } from './core/chain.js';
import { html, render, $, esc, short, toast, fmtNum, setExplorer, errMsg, isMobile, metamaskDeepLink } from './core/ui.js';

const E = () => globalThis.ethers;
const view = $('#view');

let scope = [];
const app = {
  onBlock(fn) { scope.push(onBlock(fn)); },
  onWallet(fn) { scope.push(onWallet(fn)); },
  every(ms, fn) { const id = setInterval(fn, ms); scope.push(() => clearInterval(id)); },
  cleanup(fn) { scope.push(fn); },
};

function drawNav() {
  const navMods = MODULES.filter((m) => m.nav !== false);
  const groups = [...new Set(navMods.map((m) => m.group))];
  render($('#nav'), html`
    <div class="brand"><span class="logo">원</span><div><b>${chain.cfg?.appName || '청라더헤븐'}</b><small>서길원 SGW 거래소${chain.cfg ? ' · ' + chain.cfg.network.name.toUpperCase() : ''}</small></div></div>
    ${groups.map((g) => html`<div class="group">${g}</div>${navMods.filter((m) => m.group === g).map((m) => html`<a href="#/${m.id}" data-id="${m.id}"><span class="ico">${m.icon}</span>${m.title}</a>`)}`)}
    <div class="group">안내</div>
    <a href="guide.html" target="_blank" rel="noopener"><span class="ico">DOC</span>참여 안내서</a>
    <div class="nav-foot">1 sgw = 1원 · 가상 거래소<br>모든 기록은 ${chain.cfg?.network.name || '블록체인'} 장부에 있고, 이 화면은 그 장부를 읽어 보여줄 뿐입니다.</div>
  `);
}
async function route() {
  scope.forEach((off) => { try { off(); } catch {} });
  scope = [];
  const [id = 'home', ...params] = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  const mod = MODULES.find((m) => m.id === id) || MODULES[0];
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.id === mod.id || (['tx', 'blocks', 'address'].includes(mod.id) && a.dataset.id === 'explore')));
  $('#nav').classList.remove('open');
  const page = document.createElement('div');
  page.innerHTML = '<div class="loading">불러오는 중…</div>';
  view.replaceChildren(page);
  window.scrollTo(0, 0);
  try {
    // 다른 사람이(대납 포함) 가입했을 수 있으니 화면을 옮길 때마다 명부를 다시 읽음 (호출 1번)
    if (chain.ready) await loadMembers().catch(() => {});
    const m = (await mod.load()).default;
    document.title = `${m.title || mod.title} · ${chain.cfg?.appName || '청라더헤븐'}`;
    const myScope = scope;
    const ret = await m.render(page, params.filter(Boolean), app);
    if (typeof ret === 'function') myScope.push(ret);
  } catch (e) {
    if (!page.isConnected) return;
    console.error(e);
    render(page, html`<div class="card"><h2>화면을 그리지 못했습니다</h2><pre class="code">${e.stack || e.message}</pre></div>`);
  }
}

function drawStatus(ok = true) {
  const el = $('#chainStatus');
  if (!ok) { el.className = 'chip down'; el.innerHTML = '<span class="dot"></span>노드 연결 끊김'; return; }
  el.className = 'chip live';
  el.innerHTML = `<span class="dot"></span>${esc(chain.cfg.network.name)} #${fmtNum(chain.head)}`;
  el.title = `읽기 전용 공개 노드: ${chain.provider._getConnection().url}`;
}

// MetaMask 의 '스마트 계정'(EIP-7702)이 켜지면 지갑 주소에 MetaMask 프로그램이 붙고(코드 0xef0100…), MetaMask 가 거래를 감싸 보내 실패하거나 엉뚱하게 처리될 수 있다
let smartChecked = null;
async function checkSmartAccount() {
  const a = wallet.address;
  document.getElementById('smartBar')?.remove();
  if (!a || !wallet.chainOk || smartChecked === a) return;
  smartChecked = a;
  const code = await rpc('eth_getCode', [a, 'latest']).catch(() => '0x');
  if (!String(code).toLowerCase().startsWith('0xef0100')) return;
  const bar = document.createElement('div');
  bar.id = 'smartBar';
  bar.className = 'mm-bar';
  bar.innerHTML = '<span><b>이 지갑이 MetaMask ‘스마트 계정’으로 바뀌어 있습니다.</b> MetaMask 가 거래를 감싸 보내 실패하거나 반영이 안 될 수 있어요. MetaMask <b>설정 → 스마트 계정 → ' + esc(chain.cfg.network.name) + '</b> 스위치를 끄세요 (확인 1번).</span>';
  view.before(bar);
}

function drawWallet() {
  smartChecked = null;
  checkSmartAccount();
  const b = $('#walletBtn');
  if (!wallet.installed) { b.className = 'btn'; b.textContent = 'MetaMask 설치 필요'; return; }
  if (!wallet.address) { b.className = 'btn btn-primary'; b.textContent = 'MetaMask 연결'; return; }
  if (!wallet.chainOk) { b.className = 'btn btn-danger'; b.textContent = `${chain.cfg.network.name} 로 전환`; return; }
  const nick = chain.members[wallet.address.toLowerCase()];
  b.className = 'btn';
  b.innerHTML = esc(nick || short(wallet.address));
}

$('#walletBtn').addEventListener('click', async () => {
  try {
    if (!wallet.installed) location.hash = '#/home';
    else if (!wallet.address) await connectWallet();
    else if (!wallet.chainOk) await switchNetwork();
    else location.hash = '#/home';
  } catch (e) { toast(errMsg(e), 'bad'); }
});
$('#navToggle').addEventListener('click', () => $('#nav').classList.toggle('open'));

$('#search').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const q = $('#searchInput').value.trim();
  if (!q) return;
  if (/^\d+$/.test(q)) location.hash = `#/blocks/${q}`;
  else if (E().isAddress(q)) location.hash = `#/address/${E().getAddress(q)}`;
  else if (/^0x[0-9a-fA-F]{64}$/.test(q)) {
    const tx = await rpc('eth_getTransactionByHash', [q]).catch(() => null);
    if (tx) location.hash = `#/tx/${q}`;
    else {
      const b = await rpc('eth_getBlockByHash', [q, false]).catch(() => null);
      if (b) location.hash = `#/blocks/${Number(b.number)}`;
      else toast('그 해시의 거래·블록을 찾지 못했습니다', 'bad');
    }
  } else {
    const a = Object.entries(chain.members).find(([, n]) => n === q);
    if (a) location.hash = `#/address/${E().getAddress(a[0])}`;
    else toast('블록 번호, 주소(0x…42자), 거래 해시(0x…66자), 또는 닉네임을 입력하세요', 'bad');
  }
});

function setupRpcLog() {
  const drawer = $('#rpclog');
  const body = $('#rpclogBody');
  let count = 0;
  $('#rpclogToggle').addEventListener('click', () => drawer.classList.toggle('open'));
  $('#rpclogClear').addEventListener('click', () => { body.innerHTML = ''; });
  body.addEventListener('click', (ev) => ev.target.closest('.rpc-line')?.classList.toggle('expanded'));
  onRpc((e) => {
    count++;
    $('#rpcCount').textContent = `· ${count}회`;
    if ($('#rpclogPause').checked || e.method === 'eth_blockNumber') return;
    const line = document.createElement('div');
    line.className = 'rpc-line';
    const res = e.error ? `<span class="err">오류 ${esc(JSON.stringify(e.error))}</span>` : esc(JSON.stringify(e.result));
    line.innerHTML = `<span class="m">${esc(e.method)}</span>(${esc(JSON.stringify(e.params))}) → ${res} <span class="muted">${e.ms}ms</span>`;
    body.prepend(line);
    while (body.childElementCount > 300) body.lastChild.remove();
  });
}

// MetaMask 앱으로 넘어오며 ?go= 에 담아 온 화면 주소(대납 링크 등)를 # 로 되돌림
{
  const q = new URLSearchParams(location.search);
  const go = q.get('go');
  if (go && go.startsWith('#/')) {
    q.delete('go');
    history.replaceState(null, '', location.pathname + (q.size ? '?' + q : '') + go);
  }
}

// 휴대폰 일반 브라우저(카톡 안 브라우저 포함)에는 지갑이 없으므로, 어느 화면에서든 MetaMask 앱으로 넘기는 띠를 보여 줌
function drawMobileBar() {
  if (!isMobile() || wallet.installed || document.getElementById('mmBar')) return;
  const bar = document.createElement('div');
  bar.id = 'mmBar';
  bar.className = 'mm-bar';
  bar.innerHTML = '<span>휴대폰에서는 <b>MetaMask 앱</b> 안에서 열어야 서명할 수 있어요.</span>'
    + '<span class="mm-acts"><a class="btn btn-primary" id="mmOpen">MetaMask 앱에서 열기</a><button class="btn" id="mmCopy">주소 복사</button></span>';
  view.before(bar);
  // 누르는 순간의 화면(#/relay/… 포함)으로 연결
  $('#mmOpen').addEventListener('click', (ev) => { ev.preventDefault(); location.href = metamaskDeepLink(); });
  $('#mmCopy').addEventListener('click', () => {
    const url = location.href;
    navigator.clipboard?.writeText(url).then(() => toast('복사했습니다. MetaMask 앱 → 탐색(돋보기) → 위쪽 검색창에 붙여넣으세요.')).catch(() => prompt('복사하세요', url));
  });
}

drawNav();
setupRpcLog();
try {
  await initChain();
  setExplorer(chain.cfg.network.explorer);
  drawNav();
  drawStatus(true);
  onBlock(() => drawStatus(true));
  onStatus((ok) => drawStatus(ok));
  onWallet(drawWallet);
  startPolling();
  await initWallet();
  drawWallet();
  drawMobileBar();
  // 이 기기에서 켜 둔 자동 처리기가 있으면 이어서 돌림 (어느 화면에 있든)
  if (chain.ready) import('./core/autorelay.js').then((m) => {
    m.resume();
    const chip = document.createElement('a');
    chip.id = 'autoChip';
    chip.className = 'chip';
    chip.href = '#/inbox';
    $('#chainStatus').after(chip);
    const draw = () => { chip.style.display = m.running() ? '' : 'none'; chip.innerHTML = '<span class="dot"></span>자동 처리 중'; chip.title = '이 기기의 자동 처리기가 요청함을 처리하고 있습니다 (이 탭을 닫으면 멈춤)'; };
    draw();
    setInterval(draw, 3000);
  }).catch(() => {});
  window.addEventListener('hashchange', route);
  route();
} catch (e) {
  console.error(e);
  drawStatus(false);
  render(view, html`<div class="card"><h2>블록체인 노드에 연결하지 못했습니다</h2><p>${e.message}</p>
    <p class="muted">잠시 후 새로고침해 보세요. 공개 노드가 일시적으로 바쁠 수 있습니다.</p></div>`);
}
