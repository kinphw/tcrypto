// 공개 요청함: 서명된 대납 요청·입금 신청·ETH 요청이 모이는 우편함을 누구나 볼 수 있게 보여 준다.
// 발행자(또는 ETH 가 있는 참여자)는 여기서 바로 올리기·발행 버튼을 누른다.
import { chain, wallet, getContract, writable, track, requireWallet } from '../core/chain.js';
import { html, render, $, timeAgo, tag, busy, explain, toast, errMsg, kv, addrLink, won } from '../core/ui.js';
import { submitRelay, approveNotice, GAS_GIFT } from '../core/relay.js';
import { inboxInfo, readInbox, requestStatus, KEEP_HOURS } from '../core/inbox.js';
import { notReady } from './home.js';
import { describeRequest, statusTag } from './relay.js';

// 요청이 실제로 무엇을 하는지 (대납 중계 요청은 안에 든 함수 이름으로)
const METHOD = { join: '이름표 등록', openShop: '상점 열기', setShopOpen: '상점 영업 변경', listProduct: '상품 올리기', updateProduct: '상품 수정', createCoin: '코인 만들기', mint: '코인 발행', transferWithMemo: '코인 송금' };
const kindLabel = (obj) => obj.k === 'fwd' ? (METHOD[obj.method] || '실행')
  : obj.k === 'auth' ? (obj.auth.to.toLowerCase() === chain.cfg.issuer?.toLowerCase() ? '환매' : '송금')
  : ({ buy: '결제', notice: '입금 신청', gas: 'ETH 요청' })[obj.k] || obj.k;

const E = () => globalThis.ethers;

// ───────── 자동 처리기 카드 (발행사 서버 역할) ─────────
const RELAYER_FUND = '0.02';
const RELAYER_ALLOWANCE = 1_000_000n;
async function drawAuto(el, onChange) {
  const A = await import('../core/autorelay.js');
  const t = await getContract('Seogilwon');
  const master = await t.masterMinter();
  const me = wallet.address;
  const isMaster = !!me && master.toLowerCase() === me.toLowerCase();
  const st = await A.relayerStatus();
  const on = A.running();
  const steps = st ? [st.eth > 0n, st.minter, on] : [false, false, false];
  render(el, html`
    <div class="card-head"><h2>자동 처리기</h2>${st ? (on ? tag('켜짐 — 자동 처리 중', 'ok') : tag('꺼짐')) : tag('이 기기에 없음')}</div>
    <p class="small">켜 두면 <b>${A.INTERVAL_MS / 1000}초마다</b> 요청함을 읽어 송금·결제·상점 요청은 자동으로 올려 주고, 입금 신청은 자동으로 발행합니다. 아무도 버튼을 누를 필요가 없습니다.
      <b>이 기기 브라우저에서 이 사이트가 열려 있는 동안</b>만 돕니다 (어느 화면이든 괜찮음).</p>
    ${!st ? (isMaster
      ? html`<p class="small muted">이 기기 브라우저 안에 자동 처리기 전용 지갑을 새로 만듭니다. 열쇠는 이 브라우저에만 저장됩니다.</p><button class="btn btn-primary" id="mkRelayer">이 기기에 자동 처리기 만들기</button>`
      : html`<p class="small muted">발행 총괄(${addrLink(master)})의 기기에서 설정합니다.</p>`)
    : html`
      ${kv([
        ['처리기 지갑', addrLink(st.address, { full: true, copy: true }), '수수료를 내고 올리는 주소 — 거래 해부에서 ‘보낸 사람’으로 보임'],
        ['수수료용 ETH', `${E().formatEther(st.eth).slice(0, 10)} ETH`, st.eth > 0n ? '대납 1건에 약 0.00001 ETH' : '충전이 필요합니다'],
        ['발행 권한', st.minter ? `있음 — 남은 한도 ${won(st.allowance)}` : '없음', '발행 총괄이 정한 한도 안에서만 자동 발행'],
        ['건당 자동 발행 상한', html`<span class="row"><input id="maxMint" type="number" min="1" value="${String(A.maxMint())}" style="width:130px"> sgw <button class="btn small" id="saveMax">저장</button></span>`, '이보다 큰 입금 신청은 사람이 요청함에서 직접 처리'],
      ])}
      <ol class="steps" style="margin-top:10px">
        <li class="done"><div>지갑 만들기</div></li>
        <li class="${steps[0] ? 'done' : ''}"><div>수수료용 ETH 충전 ${isMaster ? html`<button class="btn small" id="fund">MetaMask 로 ${RELAYER_FUND} ETH 보내기</button>` : ''}</div></li>
        <li class="${steps[1] ? 'done' : ''}"><div>발행 권한 주기 ${isMaster ? html`<button class="btn small" id="grant">${st.minter ? '한도 다시 채우기' : '권한 주기'} (${won(RELAYER_ALLOWANCE)})</button>` : ''}</div></li>
        <li class="${on ? 'done' : ''}"><div>켜기 <button class="btn small ${on ? '' : 'btn-primary'}" id="toggle">${on ? '끄기' : '켜기'}</button> <button class="btn small" id="once">지금 한 번 처리</button></div></li>
      </ol>
      <details style="margin-top:8px"><summary class="small">처리 기록 (이 기기)</summary><div id="actlog" class="small"></div>
        <button class="btn small btn-danger" id="forget" style="margin-top:8px">이 기기에서 자동 처리기 지우기</button></details>`}
    ${explain('실제 발행사도 이렇게 한다 — 그리고 감독 포인트', html`
      <p>실제 발행사는 입금 확인·발행·대납을 <b>자동화된 서버</b>가 합니다. 이 서버에는 <b>발행 한도가 정해진 ‘발행 담당’ 키</b>(뜨거운 지갑)만 주고, 한도를 정하는 <b>발행 총괄 키</b>(차가운 지갑)는 따로 보관합니다.
        여기서도 처리기 지갑은 발행 담당일 뿐이고, 발행 총괄은 선생님 MetaMask 입니다.</p>
      <p><b>감독 포인트</b> — 처리기 키가 털려도 피해는 <b>남은 발행 한도</b>까지입니다. 발행 총괄은 언제든 <code>removeMinter</code> 로 권한을 빼앗을 수 있고, 모든 자동 발행은 메모에 ‘(자동)’과 신청서 지문을 남겨 신청서와 대조할 수 있습니다.</p>`, { kind: 'sup' })}`);

  const drawLog = () => { const l = $('#actlog', el); if (l) render(l, html`${A.activity().length ? html`<ul style="padding-left:18px;margin:6px 0">${A.activity().map((a) => html`<li>${a.ok ? '✓' : '·'} ${timeAgo(a.time)} — ${a.label} ${a.tx ? html`<a href="#/tx/${a.tx}">거래</a>` : ''}</li>`)}</ul>` : html`<p class="muted">아직 없음</p>`}`); };
  drawLog();
  $('#mkRelayer', el)?.addEventListener('click', () => { A.createRelayer(); drawAuto(el, onChange); });
  $('#fund', el)?.addEventListener('click', (ev) => busy(ev.target, async () => {
    await track(requireWallet().sendTransaction({ to: st.address, value: E().parseEther(RELAYER_FUND) }), '자동 처리기 충전');
    await drawAuto(el, onChange);
  }));
  $('#grant', el)?.addEventListener('click', (ev) => busy(ev.target, async () => {
    await track((await writable(t)).configureMinter(st.address, RELAYER_ALLOWANCE), '자동 처리기 발행 권한');
    await drawAuto(el, onChange);
  }));
  $('#toggle', el)?.addEventListener('click', () => { on ? A.stop() : A.start(); drawAuto(el, onChange); });
  $('#once', el)?.addEventListener('click', (ev) => busy(ev.target, async () => { const n = await A.runOnce(); toast(`${n}건 처리했습니다`, n ? 'ok' : ''); onChange?.(); await drawAuto(el, onChange); }));
  $('#saveMax', el)?.addEventListener('click', () => { const v = $('#maxMint', el).value.trim(); if (/^\d+$/.test(v)) { A.setMaxMint(v); toast('저장했습니다', 'ok'); } });
  $('#forget', el)?.addEventListener('click', () => { if (confirm('이 기기의 자동 처리기 지갑을 지웁니다. 남은 ETH 는 되찾을 수 없습니다. 계속할까요?')) { A.forgetRelayer(); drawAuto(el, onChange); } });
  return A;
}

export default {
  title: '요청함',
  async render(view, params, app) {
    if (!chain.ready) return notReady(view);
    const box = inboxInfo();
    render(view, html`
      <div class="page-head"><div><h1>요청함</h1><div class="sub">서명된 요청이 모이는 공개 우편함 · 누구나 볼 수 있음 · ${KEEP_HOURS}시간 보관</div></div>
        <button class="btn" id="reload">새로고침</button></div>

      <div class="card">
        <h2>어떻게 돌아가나</h2>
        <ol class="flow">
          <li><b>① 참여자 화면</b><span>버튼을 누르면 MetaMask 로 <b>서명만</b> 함. 거래가 아니라 수수료 0</span></li>
          <li><b>② 공개 우편함</b><span>화면이 서명을 <a href="${box.web}" target="_blank" rel="noopener">ntfy.sh/${box.topic}</a> 에 자동으로 넣음. 실제 서비스의 <b>회사 서버</b> 자리</span></li>
          <li><b>③ 요청함 (이 화면)</b><span>우편함에서 꺼내 이 브라우저가 서명을 직접 검증. 위조는 여기서 걸러짐</span></li>
          <li><b>④ 블록체인</b><span><b>자동 처리기</b>(또는 버튼을 누른 사람)가 <b>자기 ETH 로 수수료를 내고</b> 올림. 행위자는 서명한 사람으로 기록</span></li>
        </ol>
      </div>

      <div class="card" id="auto"><div class="loading">자동 처리기 확인 중…</div></div>

      <div class="card"><div class="card-head"><h2>처리 대기</h2><span class="small muted" id="who"></span></div>
        <p class="small muted"><b>올려 주기</b> = 내 ETH 로 수수료를 내고 이 요청을 블록체인에 기록해 주기. 내용은 서명한 그대로이고 바꿀 수 없습니다. <b>발행</b> = 입금을 확인하고 박형원을 찍어 주기 (발행 담당자만).</p>
        <div id="pending" class="loading">우편함 읽는 중…</div></div>
      <div class="card"><h2>처리됨 · 만료</h2><div id="done" class="loading">…</div></div>

      ${explain('실제 USDC 서비스와 비교', html`
        <p>USDC 는 처음부터 <b>서명만으로 송금</b>(EIP-3009)할 수 있게 만들어졌습니다. 이용자가 서명하면 <b>지갑·결제 회사의 서버(릴레이어)</b>가 그 서명을 받아 수수료를 내고 블록체인에 올립니다. 이용자는 ETH 가 없어도 됩니다.
        수원더헤븐도 같은 구조인데, <b>그 서버를 누구나 들여다볼 수 있는 공개 우편함으로 바꿨다</b>는 점만 다릅니다.</p>
        <div class="table-wrap"><table><thead><tr><th>단계</th><th>실제 서비스</th><th>수원더헤븐</th></tr></thead><tbody>
          <tr><td>서명</td><td>지갑 앱에서 서명</td><td>MetaMask 에서 서명 (같은 표준: EIP-712, EIP-3009, ERC-2771)</td></tr>
          <tr><td>전달</td><td>앱 → 회사 서버. <b>밖에서 안 보임</b></td><td>화면 → 공개 우편함. <b>누구나 열람</b> (위 ② 링크)</td></tr>
          <tr><td>대기열</td><td>회사 내부 데이터베이스</td><td>ntfy.sh 공개 주제, ${KEEP_HOURS}시간 보관</td></tr>
          <tr><td>올리기</td><td>서버가 자동으로. 서버가 <b>지갑 열쇠를 보관</b></td><td>사람이 버튼을 누르고 MetaMask 로. 열쇠는 사람이 보관</td></tr>
          <tr><td>장부 기록</td><td>보낸 사람 = 회사 지갑, 행위자 = 이용자</td><td>같음 — 거래 해부 화면의 ‘대납 해부’ 카드에서 확인</td></tr>
        </tbody></table></div>`, { open: true })}

      ${explain('감독 관점: 중개 서버가 할 수 있는 것과 없는 것', html`
        <p><b>할 수 없는 것</b> — 금액·받는 사람을 바꾸거나, 남의 이름으로 요청을 꾸며 내거나, 같은 서명을 두 번 쓰는 것. 서명이 깨지고, 서명 번호가 장부에 기록되기 때문입니다.</p>
        <p><b>할 수 있는 것</b> — 모든 요청을 <b>남보다 먼저 봄</b>(정보 우위), <b>올려 주지 않음</b>(검열), <b>순서를 바꿈</b>, 유효기간이 지나도록 묵혀 둠.
        실제 서비스에서는 이 서버가 비공개라 바깥에서 확인하기 어렵습니다. 여기서는 우편함이 공개라, 들어온 요청과 처리된 요청을 누구나 대조할 수 있습니다.</p>`, { kind: 'sup' })}

      ${explain('원본 그대로 보기 — 우편함과 주고받는 실제 데이터', html`
        <pre class="code">보내기  POST ${box.publish}
        본문  {"app":"cheongna-sgw","v":1,"id":"서명 지문","i":조각번호,"n":조각수,"k":"종류","from":"서명자","p":"압축된 서명 데이터"}
읽기    GET  ${box.poll}</pre>
        <p class="small muted">우편함 한 통은 4KB 까지라, 사진이 든 상품 등록처럼 긴 요청은 여러 통으로 나눠 넣고 읽을 때 합칩니다. 브라우저에서 <a href="${box.web}" target="_blank" rel="noopener">ntfy.sh/${box.topic}</a> 를 열면 들어오는 원문을 실시간으로 볼 수 있습니다.</p>
        <div id="raw" class="small muted">…</div>`)}
    `);

    const draw = async () => {
      const isMinter = wallet.address ? await (await getContract('Seogilwon')).isMinter(wallet.address).catch(() => false) : false;
      $('#who', view).textContent = wallet.address ? (isMinter ? '발행 담당자로 연결됨 — 모든 요청 처리 가능' : '연결됨 — 올려 주기·ETH 보내기 가능 (발행은 발행 담당자만)') : 'MetaMask 를 연결하면 처리할 수 있습니다';
      let res;
      try { res = await readInbox(); } catch (e) {
        render($('#pending', view), html`<div class="empty">우편함에 연결하지 못했습니다 (${errMsg(e)}). 잠시 후 새로고침하거나, 참여자에게 링크로 받아 주세요.</div>`);
        return;
      }
      const ctx = {};
      const rows = [];
      for (const it of res.items) rows.push({ ...it, st: await requestStatus(it.obj, it.v, ctx).catch(() => ['bad', '상태 확인 실패']) });
      // 처리 대기는 먼저 들어온 것부터 (같은 사람의 요청은 순서대로만 실행되므로)
      const pending = rows.filter((r) => r.st[0] === 'ready' || r.st[0] === 'wait').sort((a, b) => a.time - b.time);
      const done = rows.filter((r) => !(r.st[0] === 'ready' || r.st[0] === 'wait'));

      const row = async (r, actions) => {
        const k = r.obj.k;
        const can = r.st[0] === 'ready' && wallet.address && (k !== 'notice' || isMinter);
        const label = k === 'notice' ? '입금 확인 → 발행' : k === 'gas' ? `ETH ${GAS_GIFT} 보내기` : '올려 주기';
        return html`<tr>
          <td class="small">${timeAgo(r.time)}</td>
          <td>${tag(kindLabel(r.obj))}<div class="small muted">${r.obj.label}</div></td>
          <td class="small">${await describeRequest(r.obj, { short: true })}</td>
          <td>${statusTag(r.obj, r.st[0])}<div class="small muted">${r.st[2] ? html`<a href="#/tx/${r.st[2]}">${r.st[1]}</a>` : r.st[1]}</div></td>
          <td><div class="row">${actions && can ? html`<button class="btn btn-primary small" data-act="${r.id}">${label}</button>` : ''}<a class="btn small" href="#/relay/${r.payload}">자세히</a></div></td></tr>`;
      };
      const table = async (list, actions) => html`<div class="table-wrap"><table><thead><tr><th>들어온 때</th><th>종류</th><th>내용</th><th>상태</th><th></th></tr></thead>
        <tbody>${await Promise.all(list.map((r) => row(r, actions)))}</tbody></table></div>`;

      render($('#pending', view), pending.length ? await table(pending, true) : html`<div class="empty">처리할 요청이 없습니다</div>`);
      render($('#done', view), html`${done.length ? html`<details><summary class="small">${done.length}건 보기</summary>${await table(done, false)}</details>` : html`<div class="empty small">없음</div>`}
        ${res.bad.length ? html`<details style="margin-top:8px"><summary class="small">검증에서 걸러 낸 것 ${res.bad.length}건 (위조·변조·깨진 데이터)</summary>
          <ul class="small">${res.bad.map((b) => html`<li>${b.why} — 우편함 메시지 ${b.msgIds.join(', ')}</li>`)}</ul></details>` : ''}`);
      render($('#raw', view), html`<p>지금 우편함에 든 메시지 ${res.raw.length}통 (최근 3통 원문):</p>
        <pre class="code">${res.raw.slice(-3).map((m) => JSON.stringify({ id: m.id, time: m.time, message: m.message.length > 300 ? m.message.slice(0, 300) + '…' : m.message }, null, 2)).join('\n')}</pre>`);

      view.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', (ev) => busy(ev.target, async () => {
        const r = rows.find((x) => x.id === ev.target.dataset.act);
        const rec = r.obj.k === 'notice' ? await approveNotice(r.obj) : await submitRelay(r.obj);
        if (rec.status === 1) toast(`${r.obj.label} — 처리 완료`, 'ok');
        await draw();
      })));
    };
    $('#reload', view).addEventListener('click', (ev) => busy(ev.target, draw));
    drawAuto($('#auto', view), () => draw().catch(() => {})).then((A) => app.cleanup(A.onActivity(() => draw().catch(() => {})))).catch((e) => render($('#auto', view), html`<p class="small muted">자동 처리기를 불러오지 못했습니다: ${errMsg(e)}</p>`));
    await draw();
    app.every(20000, () => { if (!view.querySelector('button[disabled]')) draw().catch(() => {}); });
    app.onWallet(() => draw().catch(() => {}));
  },
};
