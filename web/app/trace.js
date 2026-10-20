// 통신 보기: 버튼 한 번에 무엇이 오갔는지(누른 뒤), 또는 오갈 것인지(누르기 전)를 단계별 접힌 칸으로 보여 준다
//  📱 폰 안 서명 → 📱→🖥️ 서버 요청 → 🖥️→📱 응답 → 🖥️→⛓️ 서버가 블록체인에 보낸 거래 → ⛓️ 결과
import {
  app, account, html, render, $, sheet, short, errMsg, won,
  trailEntries, trailInfo, setTrailOpener, plainJson, iface, tokDomain, fwdDomain, chainId,
} from './core.js';
import { TYPES, buildAuthorization } from '../js/core/sigs.js';

const pre = (o) => html`<pre>${typeof o === 'string' ? o : JSON.stringify(o, null, 2)}</pre>`;
const fold = (title, body, open = false) => html`<details class="raw step" ${open ? 'open' : ''}><summary>${title}</summary>${body}</details>`;
const time = (t) => new Date(t).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const CN = { Seogilwon: '박형원', Members: '명부', Market: '상점가', Bets: '내기판', Coupons: '쿠폰 시장', CoinFactory: '코인공장', Forwarder: '대납 중계기', FriendCoin: '친구 코인' };

// ───────── 누른 뒤: 실제로 오간 것 ─────────
function entryHtml(e) {
  if (e.type === 'sign') {
    return html`<li class="hop phone">
      <div class="who">📱 폰 안에서 서명 <small>${time(e.at)} · 서버로 안 보냄, 열쇠는 폰 밖으로 안 나감</small></div>
      ${fold(`서명한 내용 (EIP-712 · ${e.primaryType})`, pre({ domain: e.domain, primaryType: e.primaryType, message: e.message }))}
      ${fold('서명 결과 (65바이트)', pre({ signer: e.signer, signature: e.sig }))}
    </li>`;
  }
  if (e.type === 'http') {
    return html`<li class="hop net">
      <div class="who">📱 → 🖥️ <code>${e.method} ${e.path}</code> <small>${time(e.at)}${e.ms != null ? ` · ${e.ms}ms` : ''}</small></div>
      ${e.note ? html`<p class="muted small">${e.note}</p>` : ''}
      ${e.req ? fold('보낸 요청 (JSON)', pre(e.req)) : ''}
      ${fold(`🖥️ → 📱 받은 응답 ${e.status}`, pre(e.res))}
    </li>`;
  }
  if (e.type === 'chain') {
    const t = e.tx;
    const call = t.inner?.call || t.call;
    return html`<li class="hop chain">
      <div class="who">🖥️ → ⛓️ 서버가 블록체인에 보낸 거래 <small>블록 #${won(t.block ?? 0)}</small></div>
      <p class="muted small">보낸 사람(수수료 냄) <code>${short(t.from)}</code>${t.relayed ? html` · 서명한 사람 <code>${short(t.signer)}</code>` : ''}${call ? html` · <b>${CN[call.contract] || call.contract}.${call.method}</b>` : ''}</p>
      ${fold('보낸 거래 원본 (입력 데이터 · 서명 v r s)', pre(t.raw))}
      ${t.call ? fold(`호출 풀이 — ${t.call.contract}.${t.call.method}`, pre({ signature: t.call.signature, args: t.call.args, inner: t.inner || undefined })) : ''}
      ${fold(`⛓️ → 🖥️ 결과: ${t.status === 1 ? '성공' : t.status === 0 ? '실패' : '대기'} · 이벤트 ${t.logs.length}개`, pre({ status: t.status, gasUsed: t.gasUsed, fee: t.fee, logs: t.logs.map((l) => ({ contract: l.contract, event: l.event, args: l.args })) }))}
      <a class="small" href="#/x/tx/${t.hash}">이 거래 블록체인 보기에서 열기 ›</a>
    </li>`;
  }
  return '';
}

export function trailSheet(id) {
  const info = trailInfo(id);
  const list = trailEntries(id);
  sheet(html`<h2>통신 보기 <small class="muted">${info?.label || ''}</small></h2>
    <p class="muted small">이 버튼을 한 번 누르는 동안 오간 것을 순서대로 모았어요. 칸을 펴면 실제 JSON 이 나와요. (이 탭에만 기록되고 서버로 보내지 않아요)</p>
    ${list.length ? html`<ol class="hops">${list.map(entryHtml)}</ol>` : html`<p class="muted">기록이 없어요</p>`}`);
}
setTrailOpener(trailSheet);

// ───────── 누르기 전: 지금 입력값으로 무엇이 오갈지 ─────────
/** 시트 안에 넣는 접힌 칸. bindPreview 로 내용을 채운다 */
export const previewFold = (id = 'pv') => html`<details class="raw pv" id="${id}"><summary>🔍 이 버튼을 누르면 무엇이 오가나</summary><div class="pvbody"><p class="muted small">펴면 지금 입력한 값으로 보여 줘요</p></div></details>`;

function stepsHtml(p) {
  return html`${p.note ? html`<p class="muted small">${p.note}</p>` : ''}<ol class="hops">${p.steps.map((s) => html`<li class="hop ${s.kind || ''}"><div class="who">${s.title}</div>${s.text ? html`<p class="small">${s.text}</p>` : ''}${s.json ? fold('JSON', pre(s.json), true) : ''}</li>`)}</ol>`;
}
/** build: () => ({ steps:[{title, json?, text?, kind?}], note? }) — 칸이 열려 있을 때 입력이 바뀌면 다시 그린다 */
export function bindPreview(root, build, id = 'pv') {
  const d = $(`#${id}`, root);
  if (!d) return;
  const draw = async () => {
    if (!d.open) return;
    try { render($('.pvbody', d), stepsHtml(await build())); } catch (e) { render($('.pvbody', d), html`<p class="muted small">${errMsg(e)}</p>`); }
  };
  d.addEventListener('toggle', draw);
  root.addEventListener('input', draw);
  root.addEventListener('click', (e) => { if (e.target.closest('[data-amt],[data-d],[data-s]')) setTimeout(draw, 0); });
}

const SIGN_NOTE = '1회용 번호(nonce)와 유효기간은 누를 때 새로 만들어요. 서명값은 누른 뒤 폰에서 만들어져요.';
const CHAIN_DO = '⛓️ 블록체인: 서명에서 주소를 계산해 보낸 사람과 같은지 검사 → 같으면 실행, 아니면 거절';

/** 박형원 서명 결제·송금 미리보기 (k: auth · redeem · buy · bet · cbuy) */
export function dryPay(k, to, value, extra = {}) {
  const kind = k === 'auth' || k === 'redeem' ? 'TransferWithAuthorization' : 'ReceiveWithAuthorization';
  const a = buildAuthorization({ from: account.address, to, value: BigInt(value || 0), ttlDays: 1 });
  const call = {
    auth: '박형원.transferWithAuthorization(from, to, value, validAfter, validBefore, nonce, v, r, s)',
    redeem: '박형원.transferWithAuthorization(… → 발행사) 그다음 서버가 박형원.burn(금액) 으로 소각, 통장에 원화 입금',
    buy: '상점가.buyWithAuthorization(productId, quantity, note, buyer, …, v, r, s)',
    bet: '내기판.betWithAuthorization(betId, option, from, value, …, v, r, s)',
    cbuy: '쿠폰 시장.buyWithAuthorization(couponId, amount, buyer, …, v, r, s)',
  }[k];
  return {
    note: SIGN_NOTE,
    steps: [
      { kind: 'phone', title: `① 📱 폰 안에서 서명할 내용 (EIP-712 · ${kind}) — 서버로 안 감`, json: plainJson({ domain: tokDomain(), primaryType: kind, message: a }) },
      { kind: 'net', title: '② 📱 → 🖥️ POST /api/relay', json: plainJson({ obj: { k, chainId: chainId(), auth: a, sig: '0x…(누르면 폰에서 서명해 채움)', ...extra } }) },
      { kind: 'net', title: '③ 🖥️ → 📱 응답', json: { job: { id: '(번호)', kind: k, status: 'queued' }, duplicate: false } },
      { kind: 'chain', title: '④ 🖥️ → ⛓️ 서버가 블록체인에 보낼 호출 (수수료 ETH 는 서버가 냄)', text: call },
      { kind: 'chain', title: '⑤ ⛓️ 블록체인이 하는 일', text: CHAIN_DO },
    ],
  };
}

/** 대납 중계(명부·상점가·내기판·쿠폰의 일반 함수) 미리보기 */
export async function dryCall(contract, method, args, { gas = 600000 } = {}) {
  const data = (await iface(contract)).encodeFunctionData(method, args);
  const req = { from: account.address, to: app.cfg.contracts[contract], value: 0, gas, nonce: '(누를 때 서버에서 받아 옴)', deadline: Math.floor(Date.now() / 1000) + 7 * 86400, data };
  return {
    note: '서명할 내용 안의 data 는 “어떤 함수를 어떤 값으로 부를지”를 기계어로 적은 것이에요.',
    steps: [
      { kind: 'phone', title: '① 📱 폰 안에서 서명할 내용 (EIP-712 · ForwardRequest) — 서버로 안 감', json: plainJson({ domain: fwdDomain(), primaryType: 'ForwardRequest', message: req, 'data 풀이': `${CN[contract] || contract}.${method}(${plainJson(args).map((x) => JSON.stringify(x)).join(', ')})` }) },
      { kind: 'net', title: '② 📱 → 🖥️ POST /api/relay', json: plainJson({ obj: { k: 'fwd', chainId: chainId(), req, sig: '0x…(누르면 폰에서 서명해 채움)' } }) },
      { kind: 'net', title: '③ 🖥️ → 📱 응답', json: { job: { id: '(번호)', kind: 'fwd', status: 'queued' }, duplicate: false } },
      { kind: 'chain', title: '④ 🖥️ → ⛓️ 서버가 블록체인에 보낼 호출 (수수료 ETH 는 서버가 냄)', text: `대납 중계기.execute(req, sig) → 중계기가 서명 확인 뒤, 내 이름으로 ${CN[contract] || contract}.${method}(…) 실행` },
      { kind: 'chain', title: '⑤ ⛓️ 블록체인이 하는 일', text: CHAIN_DO },
    ],
  };
}

/** 충전 미리보기 (블록체인 밖 신청서 → 서버 은행 이체 → 발행) */
export function dryCharge(amount) {
  const n = { account: account.address, amount: BigInt(amount || 0), memo: '가상 은행 충전', issuedAt: BigInt(Math.floor(Date.now() / 1000)) };
  return {
    note: '충전 신청서는 블록체인에 올라가지 않는 서명이에요. 서버가 이 서명으로 “본인이 신청했다”를 확인해요.',
    steps: [
      { kind: 'phone', title: '① 📱 폰 안에서 서명할 내용 (EIP-712 · DepositNotice) — 서버로 안 감', json: plainJson({ domain: tokDomain(), primaryType: 'DepositNotice', message: n }) },
      { kind: 'net', title: '② 📱 → 🖥️ POST /api/relay', json: plainJson({ obj: { k: 'notice', chainId: chainId(), notice: n, sig: '0x…(누르면 폰에서 서명해 채움)' } }) },
      { kind: 'net', title: '③ 🖥️ 서버 장부(가상 은행)', text: `내 통장 −${won(amount || 0)}원 → 발행사 준비금 계좌 +${won(amount || 0)}원 (블록체인 밖)` },
      { kind: 'chain', title: '④ 🖥️ → ⛓️ 서버가 블록체인에 보낼 호출 (수수료 ETH 는 서버가 냄)', text: `박형원.mint(내 주소, ${won(amount || 0)}, "은행 충전 #번호") — 운영 지갑이 발행 담당이라 서명 없이 발행` },
    ],
  };
}

/** 출석 미리보기 (서명 없음, 서버 장부만) */
export const dryCheckin = () => ({
  note: '출석은 블록체인과 상관없는 서버 장부 일이라 서명이 없어요.',
  steps: [
    { kind: 'net', title: '① 📱 → 🖥️ POST /api/checkin', json: { addr: account.address } },
    { kind: 'net', title: '② 🖥️ → 📱 응답', json: { already: false, streak: '(연속 일수)', paid: [{ kind: 'checkin', amount: app.cfg.rewards.checkinReward }] } },
  ],
});
