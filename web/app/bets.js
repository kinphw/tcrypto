// 내기판: 누구나 질문과 선택지로 내기를 열고, 마감 전까지 박형원을 건다.
// 마감 뒤 만든 사람이 결과를 정하면, 이긴 쪽에 건 사람들이 전체 판돈을 건 금액 비율대로 자동으로 나눠 받는다.
import { techFold, app, api, account, html, render, $, $$, won, who, until, when, ago, sheet, busy, toast, submit, signCall, signPay, amountPicker, bindAmount, onSettled } from './core.js';

const STATE = { open: '진행 중', closed: '마감 · 결과 기다림', resolved: '결과 나옴', cancelled: '취소 · 환불' };
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const me = () => account.address.toLowerCase();

const odds = (b, i) => (b.pools[i] ? (b.pool / b.pools[i]).toFixed(2) : '—');

function card(b) {
  return html`<a class="card bet ${b.state}" href="#/bets/${b.id}">
    <div class="bet-top"><span class="tag ${b.state}">${STATE[b.state]}</span><span class="muted small">${b.state === 'open' ? until(b.closesAt) : b.resolvedAt ? ago(b.resolvedAt) : when(b.closesAt)}</span></div>
    <h3>${b.question}</h3>
    <div class="bars">${b.options.map((o, i) => html`<div class="bar ${b.winner === i ? 'win' : ''} ${b.mine?.stakes?.[i] ? 'mine' : ''}"><span class="fill" style="width:${pct(b.pools[i], b.pool)}%"></span><span class="lab">${b.winner === i ? '🏆 ' : ''}${o}</span><span class="num">${pct(b.pools[i], b.pool)}%</span></div>`)}</div>
    <div class="bet-foot muted small">판돈 <b>${won(b.pool)}</b> phw · ${b.bettors}명 · ${who(b.creator)} 님이 열었어요${b.mine ? html` · <span class="minehint">나도 걸었음</span>` : ''}</div>
  </a>`;
}

export default async function bets(page, params) {
  if (params[0]) return detail(page, Number(params[0]));
  const filter = sessionStorage.getItem('tc.betFilter') || 'live';
  const draw = async () => {
    const list = await api(`bets?me=${account.address}`);
    const F = {
      live: (b) => b.state === 'open' || b.state === 'closed',
      mine: (b) => b.mine || b.creator === me(),
      done: (b) => b.state === 'resolved' || b.state === 'cancelled',
    };
    const f = sessionStorage.getItem('tc.betFilter') || filter;
    const shown = list.filter(F[f]);
    render(page, html`
      <section class="head-row"><h1>내기판</h1><button class="btn primary" id="new">＋ 내기 열기</button></section>
      <div class="seg">${[['live', '진행 중'], ['mine', '내 내기'], ['done', '끝난 내기']].map(([k, t]) => html`<button data-f="${k}" class="${k === f ? 'on' : ''}">${t}</button>`)}</div>
      ${shown.length ? html`<div class="bet-list">${shown.map(card)}</div>` : html`<div class="empty"><div class="big-emoji">⚑</div><p>${f === 'live' ? '진행 중인 내기가 없어요. 처음으로 열어 보세요!' : '아직 없어요'}</p></div>`}
      <p class="fine">가상 화폐 놀이입니다. 현금이나 물건을 걸지 마세요.</p>`);
    $$('[data-f]', page).forEach((b) => b.addEventListener('click', () => { sessionStorage.setItem('tc.betFilter', b.dataset.f); draw(); }));
    $('#new', page).addEventListener('click', createSheet);
  };
  await draw();
  const off = onSettled(() => draw().catch(() => {}));
  const t = setInterval(() => { if (!document.querySelector('.sheet-wrap')) draw().catch(() => {}); }, 15000);
  return () => { off(); clearInterval(t); };
}

async function detail(page, id) {
  const draw = async () => {
    const b = await api(`bets/${id}?me=${account.address}`);
    const mine = b.mine;
    const isCreator = b.creator === me();
    const myTotal = mine ? mine.stakes.reduce((x, y) => x + y, 0) : 0;
    const grace = app.cfg.rewards.settleGraceMinutes;
    render(page, html`
      <a class="back" href="#/bets">‹ 내기판</a>
      <section class="card bet-detail">
        <div class="bet-top"><span class="tag ${b.state}">${STATE[b.state]}</span><span class="muted small">마감 ${when(b.closesAt)}${b.state === 'open' ? ` · ${until(b.closesAt)}` : ''}</span></div>
        <h1>${b.question}</h1>
        <p class="muted small">${who(b.creator)} 님이 열었어요 · 판돈 <b>${won(b.pool)}</b> phw · ${b.bettors}명</p>
        <div class="options">${b.options.map((o, i) => html`
          <button class="opt ${b.winner === i ? 'win' : ''} ${mine?.stakes?.[i] ? 'mine' : ''}" data-opt="${i}" ${b.state !== 'open' ? 'disabled' : ''}>
            <span class="fill" style="width:${pct(b.pools[i], b.pool)}%"></span>
            <span class="lab">${b.winner === i ? '🏆 ' : ''}${o}</span>
            <span class="meta">${won(b.pools[i])} · ${pct(b.pools[i], b.pool)}% · ×${odds(b, i)}</span>
            ${mine?.stakes?.[i] ? html`<span class="my">내가 ${won(mine.stakes[i])}</span>` : ''}
          </button>`)}</div>
        ${b.state === 'open' ? html`<p class="hint">선택지를 눌러 걸어요. ×배수는 지금 기준 예상 배당이에요 (마감까지 바뀌어요).</p>` : ''}
        ${mine ? html`<div class="mybox">
          ${b.state === 'resolved' || b.state === 'cancelled'
            ? mine.claimed != null ? html`✔ <b>${won(mine.claimed)} phw</b> 받았어요` : mine.payout > 0 ? html`🏆 받을 돈 <b>${won(mine.payout)} phw</b> — ${b.state === 'cancelled' ? '곧 환불돼요' : `결과 ${grace}분 뒤 자동으로 들어와요`}` : html`이번엔 졌어요 (건 돈 ${won(myTotal)} phw)`
            : html`내가 건 돈 <b>${won(myTotal)} phw</b>`}</div>` : ''}
        ${isCreator && b.state === 'closed' ? html`<div class="creator"><h3>결과 정하기</h3><p class="muted small">정직하게 정해 주세요. 결과 뒤 ${grace}분 동안은 관리자가 바로잡을 수 있어요.</p>
          <div class="row wrap">${b.options.map((o, i) => html`<button class="btn" data-res="${i}">${o}</button>`)}</div></div>` : ''}
        ${isCreator && b.state === 'open' && b.pool === 0 ? html`<button class="btn ghost danger" id="cancel">아무도 안 걸었으니 취소</button>` : ''}
      </section>
      ${b.people?.length ? html`<section class="card"><h2>건 사람들</h2><ul class="list">${b.people.map((x) => html`<li><b>${x.name || who(x.addr)}</b><span class="muted">${x.stakes.map((s, i) => (s ? `${b.options[i]} ${won(s)}` : '')).filter(Boolean).join(' · ')}</span></li>`)}</ul></section>` : ''}
      <section class="card"><button class="btn" id="shareBet">이 내기 친구에게 보내기</button>
        ${techFold([['내기판 컨트랙트', app.cfg.contracts.Bets, 'addr'], ['내기 번호', String(b.id)], ['만든 사람', b.creator, 'addr'], ['마감 (유닉스 시각)', String(b.closesAt)], ['선택지별 판돈', Object.fromEntries(b.options.map((o, i) => [o, b.pools[i]])), 'json'], ['건 사람 원본', b.people, 'json']])}</section>`);

    $$('[data-opt]', page).forEach((btn) => btn.addEventListener('click', () => betSheet(b, Number(btn.dataset.opt))));
    $$('[data-res]', page).forEach((btn) => btn.addEventListener('click', busy(btn, async () => {
      const i = Number(btn.dataset.res);
      if (!confirm(`결과를 “${b.options[i]}”(으)로 정할까요?`)) return;
      await submit(await signCall('Bets', 'resolve', [b.id, i], { gas: 200000, label: '결과 정하기' }), `결과: ${b.options[i]}`);
    })));
    $('#cancel', page)?.addEventListener('click', busy($('#cancel', page), async () => submit(await signCall('Bets', 'cancel', [b.id], { gas: 150000 }), '내기 취소')));
    $('#shareBet', page).addEventListener('click', () => {
      const url = `${location.origin}/?i=${encodeURIComponent(app.me.user.name)}#/bets/${b.id}`;
      const text = `[수원더헤븐 내기] ${b.question} — ${b.options.join(' vs ')}`;
      if (navigator.share) navigator.share({ title: '수원더헤븐 내기', text, url }).catch(() => {});
      else navigator.clipboard?.writeText(`${text}\n${url}`).then(() => toast('링크를 복사했어요'));
    });
  };
  await draw();
  const off = onSettled(() => draw().catch(() => {}));
  const t = setInterval(() => { if (!document.querySelector('.sheet-wrap')) draw().catch(() => {}); }, 10000);
  return () => { off(); clearInterval(t); };
}

function betSheet(b, i) {
  const sgw = app.me.sgw;
  sheet(html`<h2>“${b.options[i]}”에 걸기</h2><p class="muted small">${b.question}</p>
    ${amountPicker('amt', [1000, 5000, 10000, 30000], { unit: 'phw' })}
    <div class="balline">지갑 <b>${won(sgw)} phw</b> ${sgw < 1000 ? html`· <a href="#/" class="small">충전하러 가기</a>` : ''}</div>
    <div class="est muted" id="est"></div>
    <button class="btn primary big" id="go">걸기</button>`, {
    onMount: (body, close) => {
      const get = bindAmount(body, 'amt', sgw);
      const input = $('#amt', body);
      input.addEventListener('input', () => {
        const v = Math.floor(Number(input.value)) || 0;
        const pool = b.pool + v, mineOpt = b.pools[i] + v;
        $('#est', body).textContent = v ? `지금 이기면 약 ${won(Math.floor((v * pool) / mineOpt))} phw 받아요` : '';
      });
      $('#go', body).addEventListener('click', busy($('#go', body), async () => {
        const v = get();
        if (v > sgw) throw new Error('지갑 잔액이 부족해요. 홈에서 충전하세요');
        const obj = await signPay('bet', app.cfg.contracts.Bets, v, { betId: b.id, option: i, label: `내기 #${b.id} “${b.options[i]}” ${won(v)}` });
        close();
        await submit(obj, `“${b.options[i]}”에 ${won(v)} phw`);
      }));
    },
  });
}

function createSheet() {
  const presets = [['1시간', 3600], ['3시간', 3 * 3600], ['내일 이맘때', 86400], ['3일', 3 * 86400], ['1주일', 7 * 86400]];
  sheet(html`<h2>내기 열기</h2>
    <label class="lbl">질문</label><input id="q" maxlength="60" placeholder="예) 토요일 경기 누가 이겨?">
    <label class="lbl">선택지</label><div id="opts"><input class="o" maxlength="20" placeholder="선택지 1"><input class="o" maxlength="20" placeholder="선택지 2"></div>
    <button class="btn ghost small" id="addOpt">＋ 선택지 추가</button>
    <label class="lbl">마감</label><div class="chips">${presets.map(([t, s], k) => html`<button type="button" class="chip ${k === 2 ? 'on' : ''}" data-s="${s}">${t}</button>`)}</div>
    <input id="at" type="datetime-local">
    <p class="hint">마감 뒤 결과는 내가 정해요. 공정하게!</p>
    <button class="btn primary big" id="go">열기</button>`, {
    onMount: (body, close) => {
      const at = $('#at', body);
      const setAt = (sec) => { const d = new Date(Date.now() + sec * 1000); d.setSeconds(0, 0); at.value = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
      setAt(86400);
      $$('[data-s]', body).forEach((c) => c.addEventListener('click', () => { $$('[data-s]', body).forEach((x) => x.classList.toggle('on', x === c)); setAt(Number(c.dataset.s)); }));
      $('#addOpt', body).addEventListener('click', () => {
        const n = $$('.o', body).length;
        if (n >= 8) return toast('선택지는 8개까지');
        $('#opts', body).insertAdjacentHTML('beforeend', `<input class="o" maxlength="20" placeholder="선택지 ${n + 1}">`);
      });
      $('#go', body).addEventListener('click', busy($('#go', body), async () => {
        const q = $('#q', body).value.trim();
        const opts = $$('.o', body).map((i) => i.value.trim()).filter(Boolean);
        if (!q) throw new Error('질문을 써 주세요');
        if (opts.length < 2) throw new Error('선택지를 2개 이상 써 주세요');
        if (new Set(opts).size !== opts.length) throw new Error('같은 선택지가 있어요');
        const closes = Math.floor(new Date(at.value).getTime() / 1000);
        if (!(closes > Date.now() / 1000 + 120)) throw new Error('마감은 2분 뒤 이후로 정해 주세요');
        const obj = await signCall('Bets', 'create', [q, opts, closes], { gas: 900000, label: '내기 열기' });
        close();
        await submit(obj, `내기 열기: ${q}`);
        sessionStorage.setItem('tc.betFilter', 'live');
      }));
    },
  });
}
