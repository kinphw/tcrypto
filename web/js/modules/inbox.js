// 공개 요청함: 서명된 대납 요청·입금 신고·ETH 요청이 모이는 우편함을 누구나 볼 수 있게 보여 준다.
// 발행자(또는 ETH 가 있는 참여자)는 여기서 바로 올리기·발행 버튼을 누른다.
import { chain, wallet, getContract } from '../core/chain.js';
import { html, render, $, timeAgo, tag, busy, explain, toast, errMsg } from '../core/ui.js';
import { submitRelay, approveNotice, GAS_GIFT } from '../core/relay.js';
import { inboxInfo, readInbox, requestStatus, KEEP_HOURS } from '../core/inbox.js';
import { notReady } from './home.js';
import { describeRequest, statusTag } from './relay.js';

const SHORT = { fwd: '대납 실행', auth: '서명 송금', buy: '서명 결제', notice: '입금 신고', gas: 'ETH 요청' };

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
          <li><b>④ 블록체인</b><span>발행자 등이 버튼을 누르면 <b>자기 ETH 로 수수료를 내고</b> 올림. 행위자는 서명한 사람으로 기록</span></li>
        </ol>
      </div>

      <div class="card"><div class="card-head"><h2>처리 대기</h2><span class="small muted" id="who"></span></div><div id="pending" class="loading">우편함 읽는 중…</div></div>
      <div class="card"><h2>처리됨 · 만료</h2><div id="done" class="loading">…</div></div>

      ${explain('실제 USDC 서비스와 비교', html`
        <p>USDC 는 처음부터 <b>서명만으로 송금</b>(EIP-3009)할 수 있게 만들어졌습니다. 이용자가 서명하면 <b>지갑·결제 회사의 서버(릴레이어)</b>가 그 서명을 받아 수수료를 내고 블록체인에 올립니다. 이용자는 ETH 가 없어도 됩니다.
        청라더헤븐도 같은 구조인데, <b>그 서버를 누구나 들여다볼 수 있는 공개 우편함으로 바꿨다</b>는 점만 다릅니다.</p>
        <div class="table-wrap"><table><thead><tr><th>단계</th><th>실제 서비스</th><th>청라더헤븐</th></tr></thead><tbody>
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
      $('#who', view).textContent = wallet.address ? (isMinter ? '발행 담당자로 연결됨 — 모든 요청 처리 가능' : '연결됨 — 대납 실행·ETH 보내기 가능 (발행은 발행 담당자만)') : 'MetaMask 를 연결하면 처리할 수 있습니다';
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
        const label = k === 'notice' ? '입금 확인 → 발행' : k === 'gas' ? `ETH ${GAS_GIFT} 보내기` : '수수료 내고 올리기';
        return html`<tr>
          <td class="small">${timeAgo(r.time)}</td>
          <td>${tag(SHORT[k] || k)}<div class="small muted">${r.obj.label}</div></td>
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
    await draw();
    app.every(20000, () => { if (!view.querySelector('button[disabled]')) draw().catch(() => {}); });
    app.onWallet(() => draw().catch(() => {}));
  },
};
