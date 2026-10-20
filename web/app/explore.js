// 블록체인 보기: 주소·거래를 앱 안에서 풀어서 보여 준다 (#/x · #/x/addr/주소 · #/x/tx/해시)
import { app, api, html, raw, render, $, won, who, nameOf, ago, when, short, toast, addrOfName } from './core.js';

const E = () => globalThis.ethers;
const CNAME = { Seogilwon: '박형원 토큰', Members: '명부', Market: '상점가', Bets: '내기판', Coupons: '쿠폰 시장', CoinFactory: '코인공장', Forwarder: '대납 중계기', FriendCoin: '친구 코인' };
const EV = {
  Transfer: '박형원 이동', Mint: '발행', Burn: '소각', Joined: '가입', Placed: '내기 걸기', Created: '만들기', Resolved: '내기 결과', Cancelled: '내기 취소',
  Claimed: '내기 정산', Bought: '쿠폰 구매', Gifted: '쿠폰 선물', Redeemed: '쿠폰 사용', SaleChanged: '쿠폰 판매 설정', ShopOpened: '가게 열기', ShopStatus: '가게 열고 닫기',
  ProductListed: '상품 올리기', ProductUpdated: '상품 수정', Purchased: '상품 구매', CoinCreated: '코인 만들기', Executed: '대납 실행', AuthorizationUsed: '서명 사용',
  MinterConfigured: '발행 한도 설정', MinterRemoved: '발행 담당 해제', Blacklisted: '이용 제한', UnBlacklisted: '이용 제한 해제', Paused: '전체 정지', Unpaused: '정지 해제',
  Approval: '결제 허용', Memo: '메모', Minted: '코인 발행', ReserveAttested: '준비금 공시', OwnershipTransferred: '소유자 변경',
};
const FN = {
  execute: '대납 실행', transferWithAuthorization: '서명 송금', receiveWithAuthorization: '서명 결제', mint: '발행', burn: '소각', join: '가입',
  create: '만들기', betWithAuthorization: '내기 걸기 (서명 결제)', resolve: '결과 정하기', adminResolve: '관리자 결과 정정', cancel: '취소', claimFor: '정산 대신 받아 주기', claim: '정산 받기',
  buyWithAuthorization: '구매 (서명 결제)', gift: '선물', redeem: '사용', setSale: '판매 설정', openShop: '가게 열기', setShopOpen: '가게 열고 닫기', listProduct: '상품 올리기',
  updateProduct: '상품 수정', createCoin: '코인 만들기', configureMinter: '발행 한도 설정', removeMinter: '발행 담당 해제', blacklist: '이용 제한', unBlacklist: '이용 제한 해제',
  pause: '전체 정지', unpause: '정지 해제', transfer: '보내기', transferWithMemo: '메모와 함께 보내기',
};
const isAddr = (v) => typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v);
const contractOf = (a) => Object.entries(app.cfg.contracts).find(([, c]) => c.toLowerCase() === String(a).toLowerCase())?.[0];
const labelOf = (a) => nameOf(a) || CNAME[contractOf(a)] || (app.cfg.operator?.toLowerCase() === String(a).toLowerCase() ? '발행사 운영 지갑' : null);
const addrLink = (a) => html`<a class="xaddr" href="#/x/addr/${a}">${labelOf(a) ? html`<b>${labelOf(a)}</b> ` : ''}<code>${short(a)}</code></a>`;
const txLink = (h) => html`<a href="#/x/tx/${h}"><code>${short(h)}</code></a>`;
const eth = (wei) => { const s = E().formatEther(BigInt(wei)); return s.includes('.') ? s.replace(/(\.\d{0,6})\d*$/, '$1') : s; };
const val = (v) => (isAddr(v) ? addrLink(v) : html`<code>${typeof v === 'object' ? JSON.stringify(v) : String(v)}</code>`);
const argTable = (args) => html`<dl class="kv">${Object.entries(args || {}).map(([k, v]) => html`<dt>${k}</dt><dd>${val(v)}</dd>`)}</dl>`;
const json = (o, title = '원본 (JSON)') => html`<details class="raw"><summary>${title}</summary><pre>${JSON.stringify(o, null, 2)}</pre></details>`;
const scan = (kind, id) => (app.cfg.network.explorer ? `${app.cfg.network.explorer}/${kind}/${id}` : null);

/** 이벤트 한 줄 요약 */
function evLine(e) {
  const a = e.args || {};
  const amt = a.value ?? a.amount ?? a.total ?? a.price;
  const people = Object.values(a).filter(isAddr).map(labelOf).filter(Boolean).slice(0, 2);
  const title = a.question || (a.name && !people.includes(a.name) ? a.name : null);
  return html`<b>${EV[e.event] || e.event}</b>${amt != null ? html` · ${won(amt)}` : ''}${people.length ? html` · ${people.join(' → ')}` : ''}${title ? html` · <span class="muted">${title}</span>` : ''}`;
}

export default async function explore(page, params) {
  if (params[0] === 'addr' && params[1]) return addrPage(page, params[1]);
  if (params[0] === 'tx' && params[1]) return txPage(page, params[1]);
  render(page, html`<section class="head-row"><h1>블록체인 보기</h1></section>
    <p class="muted">${app.cfg.network.name} 블록체인에 공개된 기록을 앱 안에서 풀어 봐요. 닉네임, 지갑 주소(0x…), 거래 해시(0x… 64자리)를 넣어 보세요.</p>
    <form class="card" id="f"><div class="row"><input id="q" placeholder="닉네임 · 주소 · 거래 해시" autocomplete="off" style="flex:1"><button class="btn primary">보기</button></div></form>
    <section class="card"><h2>이 거래소의 컨트랙트</h2><ul class="list">${Object.entries(app.cfg.contracts).filter(([n]) => CNAME[n]).map(([n, a]) => html`<li><span>${CNAME[n]}</span>${addrLink(a)}</li>`)}
      ${app.cfg.operator ? html`<li><span>발행사 운영 지갑</span>${addrLink(app.cfg.operator)}</li>` : ''}</ul></section>`);
  $('#f', page).addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('#q', page).value.trim();
    if (/^0x[0-9a-fA-F]{64}$/.test(q)) location.hash = `#/x/tx/${q}`;
    else if (isAddr(q)) location.hash = `#/x/addr/${q}`;
    else if (addrOfName(q)) location.hash = `#/x/addr/${addrOfName(q)}`;
    else toast('찾지 못했어요. 닉네임·주소·거래 해시를 확인해 주세요', { kind: 'bad' });
  });
}

async function addrPage(page, addr) {
  const d = await api(`x/addr/${addr}`);
  const kind = {
    person: ['개인 지갑', '열쇠(비밀 키)를 가진 사람이 서명해서 움직이는 계정이에요. 장부에는 잔액과 거래 번호만 있어요.'],
    smart: ['스마트 계정 (개인 지갑)', `원래 개인 지갑인데, 서명 처리를 다른 프로그램에 맡겨 둔 상태예요 (EIP-7702 위임). MetaMask 스마트 계정이 이런 모양이에요.`],
    contract: ['컨트랙트 (프로그램)', '블록체인에 올라간 프로그램이에요. 아무도 서명할 수 없고 정해진 규칙대로만 움직여요.'],
  }[d.kind];
  const role = d.role === 'operator' ? '발행사 운영 지갑 — 수수료 대납·충전 발행·정산을 하는 서버 지갑' : d.role === 'issuer' ? '발행자 — 소유자·발행 총괄·프록시 관리자 (MetaMask)' : null;
  render(page, html`
    <a class="back" href="#/x">‹ 블록체인 보기</a>
    <section class="card">
      <div class="bet-top"><span class="tag">${kind[0]}</span>${d.contract ? html`<span class="tag resolved">${CNAME[d.contract] || d.contract}</span>` : ''}</div>
      <h1 style="margin-top:8px">${d.name || (d.contract ? CNAME[d.contract] : '이름 없는 주소')}</h1>
      <code class="addr">${d.address}</code>
      <p class="muted small" style="margin-top:8px">${kind[1]}${role ? html`<br><b>${role}</b>` : ''}</p>
      <div class="xstats">
        <div><small>박형원</small><b>${won(d.sgw)}</b></div>
        <div><small>ETH (수수료용)</small><b>${eth(d.eth)}</b></div>
        <div><small>${d.kind === 'contract' ? '만든 컨트랙트 수' : '보낸 거래 수'}</small><b>${d.nonce}</b></div>
      </div>
      ${d.delegate ? html`<p class="small">위임받은 프로그램: ${addrLink(d.delegate)}</p>` : ''}
      ${d.codeSize ? html`<p class="muted small">프로그램 크기 ${won(d.codeSize)}바이트</p>` : ''}
      <div class="row" style="margin-top:10px"><button class="btn small" id="cp">주소 복사</button>${scan('address', d.address) ? html`<a class="btn small ghost" href="${scan('address', d.address)}" target="_blank" rel="noopener">이더스캔</a>` : ''}</div>
    </section>
    <section class="card"><h2>기록 <small class="muted">최근 ${d.events.length}건 · 누르면 거래 자세히</small></h2>
      ${d.events.length ? html`<ul class="feed">${d.events.map((e) => html`<li><a href="#/x/tx/${e.tx}" class="grow"><span class="muted small">${CNAME[e.contract] || e.contract}</span> ${evLine(e)}</a><time>${ago(e.time)}</time></li>`)}</ul>` : html`<p class="muted">이 주소가 나온 기록이 아직 없어요</p>`}
    </section>
    ${json(d, '이 주소 원본 (JSON)')}`);
  $('#cp', page).addEventListener('click', () => navigator.clipboard?.writeText(d.address).then(() => toast('복사했어요')));
}

async function txPage(page, hash) {
  const t = await api(`x/tx/${hash}`);
  const ok = t.status === 1;
  const call = t.inner?.call || t.call;
  render(page, html`
    <a class="back" href="#/x">‹ 블록체인 보기</a>
    <section class="card">
      <div class="bet-top"><span class="tag ${t.status == null ? '' : ok ? 'resolved' : 'cancelled'}">${t.status == null ? '처리 대기' : ok ? '성공' : '실패'}</span><span class="muted small">${t.time ? when(t.time) : ''}</span></div>
      <h1 style="margin-top:8px">${call ? `${CNAME[call.contract] || call.contract} · ${FN[call.method] || call.method}` : '거래'}</h1>
      <code class="addr">${t.hash}</code>
      ${t.relayed ? html`<div class="relay">
          <div><small>서명한 사람 (실제 요청자)</small>${addrLink(t.signer)}</div>
          <div class="arrow">→ 서명만 하고 수수료 0</div>
          <div><small>올린 사람 (수수료 낸 쪽)</small>${addrLink(t.from)}</div>
        </div>
        <p class="muted small">${t.inner ? '대납 중계기(Forwarder)가 서명을 확인한 뒤, 서명한 사람의 이름으로 안쪽 호출을 실행했어요.' : '토큰 컨트랙트가 서명(EIP-3009)을 확인한 뒤, 서명한 사람의 돈을 움직였어요.'}</p>`
        : html`<dl class="kv"><dt>보낸 사람</dt><dd>${addrLink(t.from)}</dd></dl>`}
      <dl class="kv">
        <dt>받는 곳</dt><dd>${t.to ? addrLink(t.to) : '새 컨트랙트 만들기'}</dd>
        <dt>블록</dt><dd><code>#${t.block != null ? won(t.block) : '-'}</code></dd>
        <dt>수수료</dt><dd><code>${t.fee ? `${eth(t.fee)} ETH` : '-'}</code> <span class="muted small">(${won(t.gasUsed || 0)} / ${won(t.gasLimit)} 가스)</span></dd>
        <dt>거래 번호</dt><dd><code>${t.nonce}</code> <span class="muted small">보낸 사람의 ${t.nonce + 1}번째 거래</span></dd>
      </dl>
    </section>
    ${t.inner?.call ? html`<section class="card"><h2>안쪽 호출 <small class="muted">서명한 사람이 원한 것</small></h2>
      <p><b>${CNAME[t.inner.call.contract] || t.inner.call.contract}</b>.${t.inner.call.method} — ${FN[t.inner.call.method] || ''}</p>${argTable(t.inner.call.args)}</section>` : ''}
    ${t.call ? html`<section class="card"><h2>${t.inner ? '겉 호출' : '호출'} <small class="muted">${t.call.signature}</small></h2>
      <p><b>${CNAME[t.call.contract] || t.call.contract}</b>.${t.call.method} — ${FN[t.call.method] || ''}</p>${t.inner ? html`<p class="muted small">안쪽 요청과 서명을 통째로 넘김 (원본은 아래)</p>` : argTable(t.call.args)}</section>` : ''}
    <section class="card"><h2>일어난 일 <small class="muted">이벤트 ${t.logs.length}개</small></h2>
      ${t.logs.length ? html`<ul class="list xlogs">${t.logs.map((l) => html`<li><div><span class="muted small">${CNAME[l.contract] || short(l.address)}</span> <b>${EV[l.event] || l.event || '알 수 없는 이벤트'}</b> <code class="muted small">${l.event || ''}</code></div>${l.args ? argTable(l.args) : html`<pre>${JSON.stringify({ topics: l.topics, data: l.data }, null, 2)}</pre>`}</li>`)}</ul>` : html`<p class="muted">${ok ? '이벤트 없음' : '실패한 거래는 기록(이벤트)을 남기지 않아요'}</p>`}
    </section>
    ${json(t.raw, '보낸 원본 (입력 데이터 · 서명 v r s)')}
    ${json(t, '이 거래 전체 원본 (JSON)')}
    ${scan('tx', t.hash) ? html`<a class="btn ghost" href="${scan('tx', t.hash)}" target="_blank" rel="noopener">이더스캔에서도 보기</a>` : ''}`);
}
