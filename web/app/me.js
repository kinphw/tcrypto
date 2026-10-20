// 나: 초대 · 순위 · 통장 내역 · 내 요청 · 내 활동 · 계정 · 블록체인 보기
import { app, api, account, html, render, $, $$, won, who, ago, sheet, toast, busy, revealPhrase, changePassword, lock, forgetWallet, short } from './core.js';
import { feedItem, feedDetail } from './home.js';
import { bindDetails, detailSheet, xAddr, trailsList, openTrail } from './core.js';

export const inviteLink = (name) => `${location.origin}/?i=${encodeURIComponent(name)}`;
export function shareInvite(name) {
  const url = inviteLink(name);
  const text = `수원더헤븐에서 같이 놀자! 가입하면 둘 다 ${won(app.cfg.rewards.inviteReward)}원 (가상 화폐)`;
  if (navigator.share) return navigator.share({ title: '수원더헤븐 초대', text, url }).catch(() => {});
  navigator.clipboard?.writeText(`${text}\n${url}`).then(() => toast('초대 링크를 복사했어요. 카톡에 붙여넣어 보내세요'));
}

const BANK_KIND = { signup: '가입 축하금', checkin: '출석', streak: '연속 출석 보너스', invite: '초대받은 보상', inviter: '초대 보상', grant: '이벤트', charge: '충전 (→ 박형원)', 'charge-refund': '충전 되돌림', redeem: '환매 (박형원 →)' };

export default async function me(page) {
  const [m, rank, mine, adm] = await Promise.all([api(`me/${account.address}`), api('rank'), api(`feed?mine=1&me=${account.address}&limit=60`), api('admin/whoami').catch(() => ({}))]);
  const meA = account.address.toLowerCase();
  const rankList = (rows, val) => html`<ol class="rank">${rows.map((r, i) => html`<li class="${r.addr === meA ? 'me' : ''}"><span class="n">${i + 1}</span><b>${who(r.addr)}</b><span class="v">${val(r)}</span></li>`)}</ol>`;
  render(page, html`
    <section class="profile card">
      <div class="avatar">${(m.user.name || '?').slice(0, 1)}</div>
      <div><h1>${m.user.name}</h1><div class="muted small">${account.kind === 'metamask' ? 'MetaMask 지갑' : '이 브라우저 지갑'} · <a href="${xAddr(account.address)}">블록체인에서 보기</a></div><code class="small addr">${account.address}</code></div>
    </section>

    <div class="cols2 me"><div class="col">
    <section class="card invite">
      <div><b>친구 초대</b><div class="muted small">내 링크로 가입하면 둘 다 ${won(app.cfg.rewards.inviteReward)}원 · 지금까지 ${m.invited}명</div><code class="small">${inviteLink(m.user.name)}</code></div>
      <button class="btn primary" id="share">공유</button>
    </section>

    <section class="card"><div class="card-head"><h2>순위</h2><div class="seg small">${[['rich', '부자'], ['bet', '내기왕'], ['cp', '인기 쿠폰']].map(([k, t], i) => html`<button data-r="${k}" class="${i === 0 ? 'on' : ''}">${t}</button>`)}</div></div>
      <div data-rv="rich">${rankList(rank.rich, (r) => `${won(r.total)}`)}<p class="hint">통장 원화 + 지갑 박형원</p></div>
      <div data-rv="bet" hidden>${rank.betKing.length ? rankList(rank.betKing, (r) => `${r.net >= 0 ? '+' : ''}${won(r.net)}`) : html`<p class="muted">아직 끝난 내기가 없어요</p>`}</div>
      <div data-rv="cp" hidden>${rank.coupons.length ? html`<ol class="rank">${rank.coupons.map((c, i) => html`<li><span class="n">${i + 1}</span><a href="#/coupons/${c.id}"><b>${c.name}</b></a><span class="v">${c.sold}장 팔림</span></li>`)}</ol>` : html`<p class="muted">아직 없어요</p>`}</div>
    </section>

    </div><div class="col">
    <section class="card"><h2>통장 내역 <small class="muted">블록체인 밖 · 가상 은행 장부</small></h2>
      ${m.history.length ? html`<ul class="list">${m.history.map((t) => html`<li><span>${BANK_KIND[t.kind] || t.kind}<span class="muted small"> · ${ago(t.at)}</span></span><b class="${t.amount > 0 ? 'ok' : ''}">${t.amount > 0 ? '+' : ''}${won(t.amount)}원</b></li>`)}</ul>` : html`<p class="muted">아직 없어요</p>`}
    </section>

    <section class="card"><h2>내 요청 기록 <small class="muted">눌러서 원본 보기</small></h2>${m.jobs.length ? html`<ul class="list jobs">${m.jobs.map((j, i) => html`<li data-j="${i}"><span>${j.label}<span class="muted small"> · ${ago(j.createdAt)}</span></span><b class="${j.status === 'done' ? 'ok' : j.status === 'failed' ? 'bad' : ''}">${{ done: '완료', failed: '실패', queued: '대기', sent: '처리 중' }[j.status] || j.status}</b></li>`)}</ul>` : html`<p class="muted">아직 없어요</p>`}</section>

    <section class="card"><h2>최근 통신 기록 <small class="muted">이 탭에서 누른 버튼 · 누르면 오간 JSON</small></h2>${trailsList().length ? html`<ul class="list">${trailsList().slice(0, 15).map((t) => html`<li data-t="${t.id}"><span>${t.label}<span class="muted small"> · ${new Date(t.at).toLocaleTimeString('ko-KR')}</span></span><b class="${t.status === 'failed' ? 'bad' : t.status === 'done' ? 'ok' : ''}">${{ done: '완료', failed: '실패', run: '진행 중' }[t.status]}</b></li>`)}</ul>` : html`<p class="muted">아직 없어요. 충전·보내기 같은 버튼을 누르면 여기에 쌓여요.</p>`}</section>

    <section class="card"><h2>내 활동</h2>${mine.length ? html`<ul class="feed">${mine.map(feedItem)}</ul>` : html`<p class="muted">아직 없어요</p>`}</section>

    ${adm.admin ? html`<section class="card"><h2>관리자</h2><p class="muted small">이 브라우저는 관리자로 로그인돼 있어요. 다른 사람에게는 안 보여요.</p><a class="btn primary" href="/admin/" target="_blank">관리 페이지 열기</a></section>` : ''}
    <section class="card"><h2>계정</h2>
      ${account.kind === 'local' ? html`<p class="muted small">${m.vault ? '✔ 다른 기기에서 닉네임 + 비밀번호로 로그인할 수 있어요' : '⚠ 아직 서버에 로그인 정보가 없어요. 비밀번호 바꾸기를 한 번 하면 저장돼요'}</p>
        <button class="btn" id="pwc">비밀번호 바꾸기</button>
        <button class="btn" id="backup">백업 문구 보기 (비밀번호를 잊었을 때 대비)</button>` : ''}
      <a class="btn" href="#/x">블록체인 보기 (주소 · 거래 찾아보기)</a>
      ${account.address ? html`<a class="btn ghost" href="${app.cfg.network.explorer ? `${app.cfg.network.explorer}/address/${account.address}` : '#'}" target="_blank" rel="noopener">이더스캔에서 내 기록 보기</a>` : ''}
      ${account.kind === 'local' ? html`<button class="btn ghost" id="lock">잠그기</button>` : ''}
      <button class="btn ghost danger" id="out">이 기기에서 로그아웃</button>
    </section>
    </div></div>
    <p class="fine">수원더헤븐의 원화와 박형원은 가치 없는 가상 화폐예요. 현금·물품으로 바꾸지 않아요.<br>모든 거래는 이더리움 시험망(${app.cfg.network.name})에 공개 기록됩니다.</p>`);

  bindDetails(page, mine, feedDetail);
  $$('[data-t]', page).forEach((li) => li.addEventListener('click', () => openTrail(Number(li.dataset.t))));
  $$('[data-j]', page).forEach((li) => li.addEventListener('click', () => {
    const j = m.jobs[Number(li.dataset.j)];
    detailSheet({ title: j.label, tx: j.tx, addrs: [['요청한 사람', account.address]], note: j.tx ? `내가 서명한 요청을 발행사 서버가 블록체인에 올린 거래예요 (수수료는 서버가 냄). 상태: ${j.status}${j.error ? ` — ${j.error}` : ''}` : `아직 블록체인에 올라가지 않았어요. 상태: ${j.status}${j.error ? ` — ${j.error}` : ''}` });
  }));
  $('#share', page).addEventListener('click', () => shareInvite(m.user.name));
  $$('[data-r]', page).forEach((b) => b.addEventListener('click', () => {
    $$('[data-r]', page).forEach((x) => x.classList.toggle('on', x === b));
    $$('[data-rv]', page).forEach((v) => { v.hidden = v.dataset.rv !== b.dataset.r; });
  }));
  $('#backup', page)?.addEventListener('click', () => sheet(html`<h2>백업 문구</h2>
    <p class="muted">이 12단어가 곧 내 계정이에요. 비밀번호를 잊어도 이것만 있으면 되살릴 수 있어요. MetaMask 를 쓰고 싶다면 MetaMask 의 '지갑 가져오기'에 이 12단어를 넣으면 같은 계정(같은 잔액)이 열려요. <b>누구에게도 보여 주지 마세요.</b></p>
    <input id="pw" type="password" autocomplete="current-password" placeholder="비밀번호 확인"><button class="btn primary big" id="show">보기</button><div id="out"></div>`, {
    onMount: (b) => $('#show', b).addEventListener('click', busy($('#show', b), async () => {
      const phrase = await revealPhrase($('#pw', b).value);
      render($('#out', b), html`<div class="phrase">${phrase.split(' ').map((w, i) => html`<span><small>${i + 1}</small>${w}</span>`)}</div><button class="btn" id="cp">복사</button>`);
      $('#cp', b).addEventListener('click', () => navigator.clipboard?.writeText(phrase).then(() => toast('복사했어요. 안전한 곳에 붙여 두세요')));
    })),
  }));
  $('#pwc', page)?.addEventListener('click', () => sheet(html`<h2>비밀번호 바꾸기</h2>
    <input id="old" type="password" autocomplete="current-password" placeholder="지금 비밀번호">
    <input id="pw" type="password" autocomplete="new-password" placeholder="새 비밀번호 (8자 이상)" style="margin-top:8px">
    <input id="pw2" type="password" autocomplete="new-password" placeholder="새 비밀번호 한 번 더" style="margin-top:8px">
    <button class="btn primary big" id="go">바꾸기</button>`, {
    onMount: (b, close) => $('#go', b).addEventListener('click', busy($('#go', b), async () => {
      if ($('#pw', b).value !== $('#pw2', b).value) throw new Error('새 비밀번호 두 개가 달라요');
      await changePassword(m.user.name, $('#old', b).value, $('#pw', b).value);
      close(); toast('비밀번호를 바꿨어요. 다른 기기에서도 새 비밀번호로 로그인해요', { kind: 'ok' });
    })),
  }));
  $('#lock', page)?.addEventListener('click', () => { lock(); location.href = '/'; });
  $('#out', page).addEventListener('click', () => {
    const local = account.kind === 'local';
    if (!confirm(local ? '이 기기에서 계정을 지워요. 닉네임 + 비밀번호로 다시 로그인할 수 있어요 (비밀번호를 잊었다면 백업 문구가 있어야 해요). 로그아웃할까요?' : '로그아웃할까요?')) return;
    forgetWallet(); location.href = '/';
  });
}
