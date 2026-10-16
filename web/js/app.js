// 앱 진입점: 설정 읽기 → 공개 노드 연결 → MetaMask 상태 확인 → 주소(#/...)에 맞는 화면 표시
import { MODULES } from './modules/index.js';
import { chain, initChain, startPolling, onBlock, onStatus, onRpc, wallet, onWallet, initWallet, connectWallet, switchNetwork, rpc } from './core/chain.js';
import { html, render, $, esc, short, toast, fmtNum, setExplorer, errMsg } from './core/ui.js';

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
  render($('#nav'), html`
    <div class="brand"><span class="logo">₩</span><div>${chain.cfg?.appName || 'TCrypto 실험실'}<small>${chain.cfg ? chain.cfg.network.name + ' 위의 학습용 경제' : ''}</small></div></div>
    ${MODULES.filter((m) => m.nav !== false).map((m) => html`<a href="#/${m.id}" data-id="${m.id}"><span class="ico">${m.icon}</span>${m.title}</a>`)}
    <div class="nav-foot small muted">이 사이트는 화면일 뿐이고, 모든 기록은 ${chain.cfg?.network.name || '블록체인'}에 있습니다.
      MetaMask 와 이더스캔에서도 똑같이 확인할 수 있어요.</div>
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
    const m = (await mod.load()).default;
    document.title = `${m.title || mod.title} · ${chain.cfg?.appName || 'TCrypto'}`;
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

function drawWallet() {
  const b = $('#walletBtn');
  if (!wallet.installed) { b.className = 'btn'; b.textContent = 'MetaMask 설치 필요'; return; }
  if (!wallet.address) { b.className = 'btn btn-primary'; b.textContent = 'MetaMask 연결'; return; }
  if (!wallet.chainOk) { b.className = 'btn btn-danger'; b.textContent = `${chain.cfg.network.name} 로 전환`; return; }
  const nick = chain.members[wallet.address.toLowerCase()];
  b.className = 'btn';
  b.innerHTML = `🦊 ${esc(nick || short(wallet.address))}`;
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
  window.addEventListener('hashchange', route);
  route();
} catch (e) {
  console.error(e);
  drawStatus(false);
  render(view, html`<div class="card"><h2>블록체인 노드에 연결하지 못했습니다</h2><p>${e.message}</p>
    <p class="muted">잠시 후 새로고침해 보세요. 공개 노드가 일시적으로 바쁠 수 있습니다.</p></div>`);
}
