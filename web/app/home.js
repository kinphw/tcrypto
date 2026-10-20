// 홈: 통장(가상 원화)과 지갑(서길원), 충전·환매·보내기·받기, 출석, 친구 소식
import {
  bindDetails, techFold, app, api, account, html, render, $, $$, won, who, ago, sheet, busy, toast, submit, signCharge, signPay, amountPicker, bindAmount, onSettled, addrOfName, nameOf, track,
} from './core.js';
import { inviteLink, shareInvite } from './me.js';

const FEED_TEXT = {
  join: (f) => html`<b>${who(f.who)}</b> 님이 들어왔어요 👋`,
  charge: (f) => html`<b>${who(f.who)}</b> 님이 ${won(f.amount)} sgw 충전`,
  redeem: (f) => html`<b>${who(f.who)}</b> 님이 ${won(f.amount)} sgw 환매`,
  send: (f) => html`<b>${who(f.who)}</b> → <b>${who(f.to)}</b> ${won(f.amount)} sgw 💸`,
  buy: (f) => html`<b>${who(f.who)}</b> 님이 <b>${who(f.to)}</b> 님 가게에서 ${won(f.amount)} sgw 구매 🛍`,
  product: (f) => html`새 상품 <b>${f.title}</b> ${won(f.amount)} sgw`,
  'bet-new': (f) => html`<a href="#/bets/${f.betId}"><b>${who(f.who)}</b> 님이 내기를 열었어요: ${f.title}</a>`,
  'bet-place': (f) => html`<a href="#/bets/${f.betId}"><b>${who(f.who)}</b> 님이 “${f.option}”에 ${won(f.amount)} 걸었어요</a>`,
  'bet-result': (f) => html`<a href="#/bets/${f.betId}">⚑ “${f.title}” 결과: <b>${f.option}</b></a>`,
  'bet-win': (f) => html`<a href="#/bets/${f.betId}">🏆 <b>${who(f.who)}</b> 님이 내기에서 <b>${won(f.amount)}</b> sgw 땄어요</a>`,
  'coupon-new': (f) => html`<a href="#/coupons/${f.couponId}"><b>${who(f.who)}</b> 님이 쿠폰을 만들었어요: ${f.title}</a>`,
  'coupon-buy': (f) => html`<a href="#/coupons/${f.couponId}"><b>${who(f.who)}</b> 님이 “${f.title}” 쿠폰을 샀어요</a>`,
  'coupon-gift': (f) => html`<b>${who(f.who)}</b> → <b>${who(f.to)}</b> “${f.title}” 쿠폰 선물 🎁`,
  'coupon-use': (f) => html`<b>${who(f.who)}</b> 님이 “${f.title}” 쿠폰을 썼어요 ✔`,
  'coin-new': (f) => html`<b>${who(f.who)}</b> 님이 코인 ${f.title} 을 만들었어요`,
};
export const feedItem = (f, i) => html`<li data-i="${i}" title="눌러서 블록체인 원본 보기"><span>${(FEED_TEXT[f.kind] || (() => f.kind))(f)}</span><time>${ago(f.time)}</time></li>`;
/** 피드 한 줄 → 원본 보기 시트 내용 */
export const feedDetail = (f) => ({ tx: f.tx, block: f.raw?.block, contract: f.raw?.contract, event: f.raw?.event, args: f.raw?.args, addrs: [['누가', f.who], ['상대', f.to]] });

export default async function home(page, params, { refreshMe }) {
  const draw = async () => {
    const [m, feed] = await Promise.all([refreshMe(), api('feed?limit=25')]);
    const c = m.checkin || {};
    const r = app.cfg.rewards;
    const pending = m.jobs.filter((j) => j.status === 'queued' || j.status === 'sent');
    render(page, html`
      <section class="hello"><h1>${m.user.name} 님</h1>${pending.length ? html`<span class="pending"><span class="spin"></span> 처리 중 ${pending.length}건</span>` : ''}</section>

      <div class="cols2"><div class="col">
      <section class="money">
        <div class="acct bank">
          <div class="k">가상 은행 통장</div>
          <div class="v">${won(m.bank)}<small>원</small></div>
          <div class="row"><button class="btn light" id="charge">충전 → sgw</button></div>
        </div>
        <div class="acct wallet">
          <div class="k">내 지갑 · 서길원</div>
          <div class="v">${won(m.sgw)}<small>sgw</small></div>
          <div class="row"><button class="btn light" id="send">보내기</button><button class="btn light" id="recv">받기</button><button class="btn light ghost" id="redeem">환매</button></div>
        </div>
      </section>

      <section class="card checkin ${c.done ? 'done' : ''}">
        <div>
          <b>${c.done ? '오늘 출석 완료!' : `오늘 출석하고 ${won(r.checkinReward)}원 받기`}</b>
          <div class="streak">${Array.from({ length: 7 }, (_, i) => html`<span class="${i < (c.streak ? ((c.streak - 1) % 7) + 1 : 0) ? 'on' : ''}"></span>`)}<small>${c.streak ? `${c.streak}일 연속` : ''} · 7일마다 보너스 ${won(r.streakBonus)}원</small></div>
        </div>
        ${c.done ? html`<span class="stamp">✔</span>` : html`<button class="btn primary" id="checkin">출석</button>`}
      </section>

      ${techFold([['내 지갑 주소', account.address, 'addr'], ['서길원 토큰 주소', app.cfg.contracts.Seogilwon, 'addr'], ['발행사(운영 지갑)', app.cfg.operator, 'addr'], ['네트워크', `${app.cfg.network.name} (체인 번호 ${app.cfg.network.chainId})`], ['통장 원화', `${won(m.bank)}원 — 블록체인 밖 가상 은행 장부`], ['지갑 서길원', `${won(m.sgw)} sgw — 블록체인 위 서길원 장부`]], '내 계정 블록체인 정보')}

      <section class="card invite">
        <div><b>친구 초대하면 둘 다 ${won(r.inviteReward)}원</b><div class="muted small">지금까지 ${m.invited}명 초대</div></div>
        <button class="btn" id="share">초대하기</button>
      </section>

      </div><div class="col">
      <section class="card">
        <div class="card-head"><h2>친구들 소식</h2><span class="muted small">눌러서 원본 보기</span></div>
        ${feed.length ? html`<ul class="feed" id="feed">${feed.map(feedItem)}</ul>` : html`<p class="muted">아직 조용해요. 첫 내기를 열어 보세요!</p>`}
      </section>
      </div></div>`);

    $('#checkin', page)?.addEventListener('click', busy($('#checkin', page), async () => {
      const res = await api('checkin', { addr: account.address });
      const got = res.paid.reduce((s, p) => s + p.amount, 0);
      toast(got ? `출석 ${res.streak}일째 · 통장 +${won(got)}원${res.paid.length > 1 ? ' (연속 보너스!)' : ''}` : res.capped ? '오늘 보상이 모두 소진됐어요. 출석은 기록됐어요' : '오늘은 이미 출석했어요', { kind: 'ok' });
      draw();
    }));
    bindDetails(page, feed, feedDetail);
    $('#share', page).addEventListener('click', () => shareInvite(m.user.name));
    $('#charge', page).addEventListener('click', () => chargeSheet(m));
    $('#redeem', page).addEventListener('click', () => redeemSheet(m));
    $('#send', page).addEventListener('click', () => sendSheet(m));
    $('#recv', page).addEventListener('click', () => recvSheet(m));
  };
  await draw();
  const off = onSettled(() => draw().catch(() => {}));
  const t = setInterval(() => { if (!document.querySelector('.sheet-wrap')) draw().catch(() => {}); }, 20000);
  return () => { off(); clearInterval(t); };
}

export function chargeSheet(m) {
  sheet(html`<h2>충전하기</h2><p class="muted">통장 원화를 서길원으로 바꿔요. 1원 = 1 sgw. 발행사가 통장에서 돈을 받아 준비금으로 보관하고, 같은 금액의 서길원을 발행해 지갑에 넣어 줘요.</p>
    <div class="balline">통장 <b>${won(m.bank)}원</b></div>
    ${amountPicker('amt', [10000, 30000, 50000, 'max'])}
    <button class="btn primary big" id="go">충전</button>`, {
    onMount: (b, close) => {
      const get = bindAmount(b, 'amt', m.bank);
      $('#go', b).addEventListener('click', busy($('#go', b), async () => {
        const v = get();
        if (v > m.bank) throw new Error('통장 잔액보다 많아요');
        const obj = await signCharge(v);
        close();
        await submit(obj, `${won(v)}원 충전`);
      }));
    },
  });
}

export function redeemSheet(m) {
  sheet(html`<h2>환매하기</h2><p class="muted">서길원을 발행사에 돌려주면 그만큼 <b>소각</b>되고, 통장으로 원화가 돌아와요.</p>
    <div class="balline">지갑 <b>${won(m.sgw)} sgw</b></div>
    ${amountPicker('amt', [10000, 30000, 'max'], { unit: 'sgw' })}
    <button class="btn primary big" id="go">환매</button>`, {
    onMount: (b, close) => {
      const get = bindAmount(b, 'amt', m.sgw);
      $('#go', b).addEventListener('click', busy($('#go', b), async () => {
        const v = get();
        if (v > m.sgw) throw new Error('지갑 잔액보다 많아요');
        const obj = await signPay('redeem', app.cfg.operator, v);
        close();
        await submit(obj, `${won(v)} sgw 환매`);
      }));
    },
  });
}

export function sendSheet(m, toName = '') {
  const people = Object.entries(app.names).filter(([a]) => a !== account.address.toLowerCase()).map(([, n]) => n).sort();
  sheet(html`<h2>보내기</h2>
    <label class="lbl">받는 사람</label>
    <input id="to" list="people" placeholder="닉네임" value="${toName}" autocomplete="off"><datalist id="people">${people.map((n) => html`<option value="${n}">`)}</datalist>
    <label class="lbl">금액</label>
    ${amountPicker('amt', [1000, 5000, 10000], { unit: 'sgw' })}
    <div class="balline">지갑 <b>${won(m.sgw)} sgw</b></div>
    <button class="btn primary big" id="go">보내기</button>`, {
    onMount: (b, close) => {
      const get = bindAmount(b, 'amt', m.sgw);
      $('#go', b).addEventListener('click', busy($('#go', b), async () => {
        const name = $('#to', b).value.trim();
        const to = /^0x[0-9a-fA-F]{40}$/.test(name) ? name : addrOfName(name);
        if (!to) throw new Error('그런 닉네임이 없어요');
        if (to.toLowerCase() === account.address.toLowerCase()) throw new Error('나에게는 보낼 수 없어요');
        const v = get();
        if (v > m.sgw) throw new Error('지갑 잔액보다 많아요');
        const obj = await signPay('auth', globalThis.ethers.getAddress(to), v);
        close();
        await submit(obj, `${nameOf(to) || '상대'}에게 ${won(v)} sgw`);
      }));
    },
  });
}

function recvSheet(m) {
  sheet(html`<h2>받기</h2><p class="muted">친구에게 닉네임 <b>${m.user.name}</b> 을 알려 주면 돼요.</p>
    <div class="addrbox"><div class="muted small">내 지갑 주소 (MetaMask·이더스캔에서도 같은 주소)</div><code>${account.address}</code></div>
    <button class="btn" id="copy">주소 복사</button>`, {
    onMount: (b) => $('#copy', b).addEventListener('click', () => navigator.clipboard?.writeText(account.address).then(() => toast('복사했어요'))),
  });
}
