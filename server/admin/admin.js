// 관리 페이지: 서버 API(/api/admin/*)만 쓴다. 서명·수수료는 서버 운영 지갑이 처리.
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const won = (n) => `${Number(n || 0).toLocaleString()}`;
const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');
const time = (t) => (t ? new Date(t * 1000).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const eth = (wei) => (Number(BigInt(wei || 0) / 10n ** 12n) / 1e6).toFixed(4);

function toast(msg, ms = 3000) {
  const t = $('#toast'); t.textContent = msg; t.style.display = 'block';
  clearTimeout(toast.h); toast.h = setTimeout(() => (t.style.display = 'none'), ms);
}

async function api(path, body) {
  const r = await fetch(`/api/admin/${path}`, { method: body ? 'POST' : 'GET', headers: body ? { 'content-type': 'application/json', 'x-tc': '1' } : {}, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { showLogin(); throw new Error(j.error || '로그인이 필요합니다'); }
  if (!r.ok) throw new Error(j.error || `오류 ${r.status}`);
  return j;
}
const act = async (path, body, msg) => {
  try { const r = await api(path, body); toast(r.job ? `${msg} — 처리 대기열에 넣었습니다 (#${r.job.id})` : msg); render(); return r; } catch (e) { toast(e.message, 5000); }
};

function showLogin() { $('#app').classList.add('hide'); $('#login').classList.remove('hide'); $('#pw').focus(); }
$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try { await api('login', { password: $('#pw').value }); $('#pw').value = ''; start(); } catch (err) { $('#loginMsg').textContent = err.message; }
});
$('#logout').addEventListener('click', async () => { await api('logout', {}).catch(() => {}); showLogin(); });

let names = {};
const who = (a) => (names[a?.toLowerCase()] ? `${esc(names[a.toLowerCase()])} <span class="muted mono">${short(a)}</span>` : `<span class="mono">${short(a)}</span>`);

// ───── 화면들 ─────
const TABS = {
  async 현황(v) {
    const o = await api('overview');
    $('#netName').textContent = `운영 지갑 ${short(o.operator)}`;
    const r = o.reconcile || {};
    const warn = [];
    if (!o.isMinter) warn.push('운영 지갑에 발행 권한이 없습니다 → 발행자 MetaMask 로 configureMinter(운영 지갑, 한도)');
    if (BigInt(o.allowance) < 500000n && o.isMinter) warn.push(`남은 발행 한도가 적습니다 (${won(o.allowance)}) → 발행자 MetaMask 로 한도 충전`);
    if (BigInt(o.eth) < 10n ** 16n) warn.push(`운영 지갑 ETH 가 적습니다 (${eth(o.eth)}) → 세폴리아 ETH 를 보내 주세요`);
    if (!o.roles.pauser) warn.push('정지 권한이 운영 지갑에 없습니다 (updatePauser)');
    if (!o.roles.blacklister) warn.push('차단 권한이 운영 지갑에 없습니다 (updateBlacklister)');
    if (o.roles.betsAdmin === false) warn.push('내기판 관리자가 운영 지갑이 아닙니다');
    if (r.ok === false) warn.push('준비금과 총발행량이 맞지 않습니다!');
    if (o.paused) warn.push('지금 전체 거래가 정지 상태입니다');
    v.innerHTML = `
      ${warn.length ? `<div class="card"><h2 class="warn">확인 필요</h2>${warn.map((w) => `<div class="warn">• ${esc(w)}</div>`).join('')}</div>` : ''}
      <div class="grid">
        <div class="card stat"><div class="k">총발행량</div><div class="v">${won(r.supply)} sgw</div><div class="s">소각 대기 ${won(r.pendingBurn)}</div></div>
        <div class="card stat"><div class="k">준비금 계좌 (가상 은행)</div><div class="v ${r.ok ? 'ok' : 'bad'}">${won(r.reserve)}원</div><div class="s">${r.ok ? '총발행량 − 소각 대기와 일치 ✓' : '불일치 ✗'}</div></div>
        <div class="card stat"><div class="k">참여자</div><div class="v">${won(o.users)}명</div><div class="s">통장 예금 합계 ${won(o.bank.deposits)}원</div></div>
        <div class="card stat"><div class="k">오늘 보상 지급</div><div class="v">${won(o.rewardedToday)}원</div><div class="s">하루 상한 ${won(o.settings.dailyRewardCap)}원</div></div>
        <div class="card stat"><div class="k">남은 발행 한도</div><div class="v">${won(o.allowance)}</div><div class="s">${o.isMinter ? '발행 담당 ✓' : '발행 권한 없음'}</div></div>
        <div class="card stat"><div class="k">운영 지갑 ETH</div><div class="v">${eth(o.eth)}</div><div class="s mono">${esc(o.operator)}</div></div>
        <div class="card stat"><div class="k">처리 대기열</div><div class="v">${won((o.queue.queued || 0) + (o.queue.sent || 0))}건</div><div class="s">완료 ${won(o.queue.done)} · 실패 <span class="${o.queue.failed ? 'bad' : ''}">${won(o.queue.failed)}</span></div></div>
        <div class="card stat"><div class="k">색인</div><div class="v">#${won(o.index.at)}</div><div class="s">체인 끝 #${won(o.index.head)}</div></div>
      </div>
      <div class="card"><h2>권한</h2>
        <div>정지 ${o.roles.pauser ? '<span class="ok">운영 지갑</span>' : '<span class="bad">아님</span>'} · 차단 ${o.roles.blacklister ? '<span class="ok">운영 지갑</span>' : '<span class="bad">아님</span>'} · 내기판 관리 ${o.roles.betsAdmin ? '<span class="ok">운영 지갑</span>' : '<span class="bad">아님</span>'}</div>
        <div class="muted">발행 총괄 ${who(o.roles.masterMinter)} · 소유자 ${who(o.roles.owner)} (MetaMask, /lab 에서)</div>
      </div>
      <div class="card"><h2>긴급</h2>
        <div class="row"><input id="pReason" placeholder="사유 (공개 기록)" style="flex:1">
          ${o.paused ? '<button id="unpause" class="primary">정지 해제</button>' : '<button id="pause" class="danger">전체 거래 정지</button>'}</div>
      </div>`;
    $('#pause', v)?.addEventListener('click', () => confirm('모든 송금·결제를 멈춥니다. 계속할까요?') && act('pause', { on: true, reason: $('#pReason', v).value }, '전체 정지'));
    $('#unpause', v)?.addEventListener('click', () => act('pause', { on: false, reason: $('#pReason', v).value }, '정지 해제'));
  },

  async 요청(v) {
    const status = TABS.요청.status || '';
    const list = await api(`jobs?limit=150${status ? `&status=${status}` : ''}`);
    v.innerHTML = `
      <div class="row">${['', 'queued', 'sent', 'failed', 'done'].map((s) => `<button data-s="${s}" class="${s === status ? 'on' : ''}">${{ '': '전체', queued: '대기', sent: '보냄', failed: '실패', done: '완료' }[s]}</button>`).join('')}</div>
      <div class="card wrap"><table><tr><th>#</th><th>시각</th><th>누가</th><th>무엇</th><th>상태</th><th></th></tr>
      ${list.map((j) => `<tr><td>${j.id}</td><td>${time(j.createdAt)}</td><td>${j.addr ? who(j.addr) : '<span class="muted">서버</span>'}</td>
        <td>${esc(j.label)}<div class="muted mono">${esc(j.target)}.${esc(j.method)}${j.tx ? ` · ${short(j.tx)}` : ''}</div>${j.error ? `<div class="bad">${esc(j.error)}</div>` : ''}</td>
        <td class="${j.status === 'failed' ? 'bad' : j.status === 'done' ? 'ok' : 'warn'}">${esc(j.status)}</td>
        <td>${j.status === 'failed' ? `<button data-retry="${j.id}">다시</button>` : ''}</td></tr>`).join('')}</table></div>`;
    v.querySelectorAll('[data-s]').forEach((b) => b.addEventListener('click', () => { TABS.요청.status = b.dataset.s; render(); }));
    v.querySelectorAll('[data-retry]').forEach((b) => b.addEventListener('click', () => act(`retry/${b.dataset.retry}`, {}, `#${b.dataset.retry} 다시 시도`)));
  },

  async 사람(v) {
    const users = await api('users');
    const f = (TABS.사람.q || '').toLowerCase();
    const shown = users.filter((u) => !f || u.name?.toLowerCase().includes(f) || u.addr.includes(f));
    v.innerHTML = `
      <div class="card"><h2>놀이 돈 지급 (통장으로)</h2>
        <div class="row"><input id="gWho" placeholder="닉네임 또는 주소"><input id="gAmt" type="number" min="1" placeholder="금액(원)" style="width:120px"><input id="gMemo" placeholder="메모 (예: 이벤트 상품)" style="flex:1"><button id="grant" class="primary">지급</button></div></div>
      <div class="card"><h2>이용 제한 (블랙리스트, 공개 기록)</h2>
        <div class="row"><input id="bWho" placeholder="닉네임 또는 주소"><input id="bWhy" placeholder="사유" style="flex:1"><button id="bl" class="danger">차단</button><button id="ubl">차단 해제</button></div></div>
      <div class="card wrap"><div class="row"><input id="q" placeholder="찾기" value="${esc(TABS.사람.q || '')}"><span class="muted">${shown.length} / ${users.length}명</span></div>
      <table><tr><th>닉네임</th><th>가입</th><th class="num">통장(원)</th><th class="num">지갑(sgw)</th><th>출석</th><th>초대한 사람</th><th>IP</th></tr>
      ${shown.map((u) => `<tr><td>${esc(u.name)}<div class="muted mono">${short(u.addr)}</div></td><td>${time(u.joinedAt)}</td><td class="num">${won(u.bank)}</td><td class="num">${won(u.sgw)}</td>
        <td>${u.lastCheckin ? `${esc(u.lastCheckin)} (${u.streak}일)` : '-'}</td><td>${u.invitedBy ? who(u.invitedBy) : ''}</td><td class="muted mono">${esc(u.ip || '')}</td></tr>`).join('')}</table></div>`;
    $('#q', v).addEventListener('change', (e) => { TABS.사람.q = e.target.value; render(); });
    $('#grant', v).addEventListener('click', () => act('grant', { who: $('#gWho', v).value, amount: $('#gAmt', v).value, memo: $('#gMemo', v).value }, '지급했습니다'));
    $('#bl', v).addEventListener('click', () => confirm('이 계정의 송금·결제를 막습니다. 계속할까요?') && act('blacklist', { who: $('#bWho', v).value, reason: $('#bWhy', v).value, on: true }, '차단'));
    $('#ubl', v).addEventListener('click', () => act('blacklist', { who: $('#bWho', v).value, reason: $('#bWhy', v).value, on: false }, '차단 해제'));
  },

  async 내기(v) {
    const bets = await api('bets');
    const label = { open: '진행 중', closed: '마감 · 결과 대기', resolved: '결과 나옴', cancelled: '취소됨' };
    v.innerHTML = `<p class="muted">결과가 나온 뒤 자동 정산 전(유예 시간 안)에만 결과를 바로잡거나 취소할 수 있습니다. 정산이 하나라도 나가면 바꿀 수 없습니다.</p>
      <div class="card wrap"><table><tr><th>#</th><th>질문</th><th>만든 사람</th><th class="num">판돈</th><th>상태</th><th>관리</th></tr>
      ${bets.map((b) => `<tr><td>${b.id}</td><td>${esc(b.question)}<div class="muted">${b.options.map((o, i) => `${i === b.winner ? '🏆 ' : ''}${esc(o)} ${won(b.pools[i])}`).join(' · ')}</div><div class="muted">마감 ${time(b.closesAt)} · ${b.bettors}명</div></td>
        <td>${who(b.creator)}</td><td class="num">${won(b.pool)}</td><td>${label[b.state]}${b.resolvedAt ? `<div class="muted">${time(b.resolvedAt)}</div>` : ''}</td>
        <td>${b.state !== 'cancelled' ? `<div class="row">${b.state !== 'open' ? `<select data-opt="${b.id}">${b.options.map((o, i) => `<option value="${i}" ${i === b.winner ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select><button data-fix="${b.id}">결과 정하기</button>` : ''}<button class="danger" data-cancel="${b.id}">취소·환불</button></div>` : ''}</td></tr>`).join('')}</table></div>`;
    v.querySelectorAll('[data-fix]').forEach((b) => b.addEventListener('click', () => act('bet-resolve', { id: b.dataset.fix, option: $(`[data-opt="${b.dataset.fix}"]`, v).value }, `내기 #${b.dataset.fix} 결과 정정`)));
    v.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', () => confirm('이 내기를 취소하고 모두에게 환불합니다. 계속할까요?') && act('bet-cancel', { id: b.dataset.cancel }, `내기 #${b.dataset.cancel} 취소`)));
  },

  async 은행(v) {
    const log = await api('bank?limit=200');
    const kinds = { signup: '가입 축하', checkin: '출석', streak: '연속 출석', invite: '초대받음', inviter: '초대 보상', grant: '관리자 지급', charge: '충전(→준비금)', 'charge-refund': '충전 되돌림', redeem: '환매(준비금→)', seed: '준비금 시작' };
    const acct = (a) => (a === 'reserve' ? '<b>준비금</b>' : a === 'treasury' ? '<span class="muted">놀이 돈 발생</span>' : who(a));
    v.innerHTML = `<div class="card wrap"><table><tr><th>#</th><th>시각</th><th>종류</th><th>보낸 계좌</th><th>받은 계좌</th><th class="num">금액</th><th>메모</th></tr>
      ${log.map((t) => `<tr><td>${t.id}</td><td>${time(t.at)}</td><td>${esc(kinds[t.kind] || t.kind)}</td><td>${acct(t.from_acct)}</td><td>${acct(t.to_acct)}</td><td class="num">${won(t.amount)}</td><td>${esc(t.memo)}</td></tr>`).join('')}</table></div>`;
  },

  async 설정(v) {
    const o = await api('overview');
    const s = o.settings;
    const F = [
      ['signupBonus', '가입 축하금 (원)'], ['checkinReward', '매일 출석 (원)'], ['streakBonus', '7일 연속 출석 보너스 (원)'], ['inviteReward', '초대 보상 (원, 양쪽 각각)'],
      ['inviteDailyCap', '초대 보상 하루 최대 인원 (초대자 1명당)'], ['dailyRewardCap', '하루 전체 보상 상한 (원)'], ['joinsPerIpPerDay', '같은 IP 하루 가입 수'],
      ['maxChargePerDay', '1인 하루 충전 한도 (원)'], ['settleGraceMinutes', '내기 결과 뒤 자동 정산까지 (분)'],
    ];
    v.innerHTML = `<div class="card"><h2>운영 값</h2>${F.map(([k, l]) => `<div class="row"><label style="flex:1">${l}</label><input data-k="${k}" type="number" min="0" value="${s[k]}" style="width:160px"></div>`).join('')}
      <div class="row"><button id="save" class="primary">저장</button></div></div>`;
    $('#save', v).addEventListener('click', () => {
      const patch = {};
      v.querySelectorAll('[data-k]').forEach((i) => { patch[i.dataset.k] = i.value; });
      act('settings', patch, '저장했습니다');
    });
  },
};

let current = '현황';
function drawTabs() {
  $('#tabs').innerHTML = Object.keys(TABS).map((t) => `<button class="${t === current ? 'on' : ''}" data-t="${t}">${t}</button>`).join('');
  $('#tabs').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { current = b.dataset.t; drawTabs(); render(); }));
}
async function render() {
  try {
    names = await fetch('/api/names').then((r) => r.json()).catch(() => ({}));
    await TABS[current]($('#view'));
  } catch (e) { if (!/로그인/.test(e.message)) $('#view').innerHTML = `<div class="card bad">${esc(e.message)}</div>`; }
}
async function start() {
  try { await api('overview'); } catch { return; }
  $('#login').classList.add('hide'); $('#app').classList.remove('hide');
  drawTabs(); render();
  clearInterval(start.t);
  start.t = setInterval(() => { if (current === '현황' || current === '요청') render(); }, 10000);
}
start();
