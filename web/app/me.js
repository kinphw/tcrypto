// 나: 초대 · 순위 · 통장 내역 · 내 활동 · 백업 · 실험실
import { app, api, account, html, render, $, $$, won, who, ago, sheet, toast, busy, backupPhrase, forgetWallet, connectMetaMask, hasMetaMask, short } from './core.js';
import { feedItem } from './home.js';

export const inviteLink = (name) => `${location.origin}/?i=${encodeURIComponent(name)}`;
export function shareInvite(name) {
  const url = inviteLink(name);
  const text = `청라더헤븐에서 같이 놀자! 가입하면 둘 다 ${won(app.cfg.rewards.inviteReward)}원 (가상 화폐)`;
  if (navigator.share) return navigator.share({ title: '청라더헤븐 초대', text, url }).catch(() => {});
  navigator.clipboard?.writeText(`${text}\n${url}`).then(() => toast('초대 링크를 복사했어요. 카톡에 붙여넣어 보내세요'));
}

const BANK_KIND = { signup: '가입 축하금', checkin: '출석', streak: '연속 출석 보너스', invite: '초대받은 보상', inviter: '초대 보상', grant: '이벤트', charge: '충전 (→ 서길원)', 'charge-refund': '충전 되돌림', redeem: '환매 (서길원 →)' };

export default async function me(page) {
  const [m, rank, mine] = await Promise.all([api(`me/${account.address}`), api('rank'), api(`feed?mine=1&me=${account.address}&limit=60`)]);
  const meA = account.address.toLowerCase();
  const rankList = (rows, val) => html`<ol class="rank">${rows.map((r, i) => html`<li class="${r.addr === meA ? 'me' : ''}"><span class="n">${i + 1}</span><b>${who(r.addr)}</b><span class="v">${val(r)}</span></li>`)}</ol>`;
  render(page, html`
    <section class="profile card">
      <div class="avatar">${(m.user.name || '?').slice(0, 1)}</div>
      <div><h1>${m.user.name}</h1><div class="muted small mono">${short(account.address)} · ${account.kind === 'metamask' ? 'MetaMask' : '이 브라우저 지갑'}</div></div>
    </section>

    <section class="card invite">
      <div><b>친구 초대</b><div class="muted small">내 링크로 가입하면 둘 다 ${won(app.cfg.rewards.inviteReward)}원 · 지금까지 ${m.invited}명</div><code class="small">${inviteLink(m.user.name)}</code></div>
      <button class="btn primary" id="share">공유</button>
    </section>

    <section class="card"><div class="card-head"><h2>순위</h2><div class="seg small">${[['rich', '부자'], ['bet', '내기왕'], ['cp', '인기 쿠폰']].map(([k, t], i) => html`<button data-r="${k}" class="${i === 0 ? 'on' : ''}">${t}</button>`)}</div></div>
      <div data-rv="rich">${rankList(rank.rich, (r) => `${won(r.total)}`)}<p class="hint">통장 원화 + 지갑 서길원</p></div>
      <div data-rv="bet" hidden>${rank.betKing.length ? rankList(rank.betKing, (r) => `${r.net >= 0 ? '+' : ''}${won(r.net)}`) : html`<p class="muted">아직 끝난 내기가 없어요</p>`}</div>
      <div data-rv="cp" hidden>${rank.coupons.length ? html`<ol class="rank">${rank.coupons.map((c, i) => html`<li><span class="n">${i + 1}</span><a href="#/coupons/${c.id}"><b>${c.name}</b></a><span class="v">${c.sold}장 팔림</span></li>`)}</ol>` : html`<p class="muted">아직 없어요</p>`}</div>
    </section>

    <section class="card"><h2>통장 내역</h2>
      ${m.history.length ? html`<ul class="list">${m.history.map((t) => html`<li><span>${BANK_KIND[t.kind] || t.kind}<span class="muted small"> · ${ago(t.at)}</span></span><b class="${t.amount > 0 ? 'ok' : ''}">${t.amount > 0 ? '+' : ''}${won(t.amount)}원</b></li>`)}</ul>` : html`<p class="muted">아직 없어요</p>`}
    </section>

    <section class="card"><h2>내 활동</h2>${mine.length ? html`<ul class="feed">${mine.map(feedItem)}</ul>` : html`<p class="muted">아직 없어요</p>`}</section>

    <section class="card"><h2>계정</h2>
      ${account.kind === 'local' ? html`<button class="btn" id="backup">백업 문구 보기 (다른 기기에서 쓰기)</button>` : ''}
      ${account.kind === 'local' && hasMetaMask() ? html`<button class="btn" id="mm">MetaMask 로 바꾸기</button>` : ''}
      <a class="btn" href="/lab/" target="_blank">실험실 · 블록체인 들여다보기</a>
      ${account.address ? html`<a class="btn ghost" href="${app.cfg.network.explorer ? `${app.cfg.network.explorer}/address/${account.address}` : '#'}" target="_blank" rel="noopener">이더스캔에서 내 기록 보기</a>` : ''}
      <button class="btn ghost danger" id="out">이 기기에서 로그아웃</button>
    </section>
    <p class="fine">청라더헤븐의 원화와 서길원은 가치 없는 가상 화폐예요. 현금·물품으로 바꾸지 않아요.<br>모든 거래는 이더리움 시험망(${app.cfg.network.name})에 공개 기록됩니다.</p>`);

  $('#share', page).addEventListener('click', () => shareInvite(m.user.name));
  $$('[data-r]', page).forEach((b) => b.addEventListener('click', () => {
    $$('[data-r]', page).forEach((x) => x.classList.toggle('on', x === b));
    $$('[data-rv]', page).forEach((v) => { v.hidden = v.dataset.rv !== b.dataset.r; });
  }));
  $('#backup', page)?.addEventListener('click', () => sheet(html`<h2>백업 문구</h2>
    <p class="muted">이 12단어가 곧 내 계정이에요. <b>누구에게도 보여 주지 마세요.</b> 다른 기기에서 “이미 계정이 있어요 → 복구 문구”에 넣으면 같은 계정으로 들어가요.</p>
    <div class="phrase">${backupPhrase().split(' ').map((w, i) => html`<span><small>${i + 1}</small>${w}</span>`)}</div>
    <button class="btn" id="cp">복사</button>`, { onMount: (b) => $('#cp', b).addEventListener('click', () => navigator.clipboard?.writeText(backupPhrase()).then(() => toast('복사했어요. 안전한 곳에 붙여 두세요'))) }));
  $('#mm', page)?.addEventListener('click', busy($('#mm', page), async () => {
    if (!confirm('MetaMask 지갑은 다른 계정이에요. 지금 계정의 돈은 그대로 이 브라우저 지갑에 남아요. 바꿀까요?')) return;
    await connectMetaMask(); location.reload();
  }));
  $('#out', page).addEventListener('click', () => {
    const local = account.kind === 'local';
    if (!confirm(local ? '백업 문구를 적어 두지 않았다면 이 계정을 다시 찾을 수 없어요. 정말 로그아웃할까요?' : '로그아웃할까요?')) return;
    forgetWallet(); location.href = '/';
  });
}
