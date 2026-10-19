import { chain, rpc, getContract, getEvents, blockTime } from '../core/chain.js';
import { html, render, $, fmtNum, timeAgo, short, blockLink, txLink, addrLink, explain, tag, won, scan } from '../core/ui.js';
import { notReady } from './home.js';

const E = () => globalThis.ethers;

function line(c, ev) {
  const a = ev.args;
  switch (`${c}.${ev.name}`) {
    case "Members.Joined": return html`${tag("이름표")} ${addrLink(a.who)} 님이 이름표를 등록 (${a.memberNo}번째)`;
    case "Seogilwon.Mint": return html`${tag("발행", "ok")} ${addrLink(a.to)} 에게 ${won(a.amount)} 새로 발행 ${a.memo ? "— “" + a.memo + "”" : ""}`;
    case "Seogilwon.Burn": return html`${tag("소각", "warn")} ${won(a.amount)} 소멸 ${a.memo ? "— “" + a.memo + "”" : ""}`;
    case "Seogilwon.Memo": return html`${tag("송금", "info")} ${addrLink(a.from)} → ${addrLink(a.to)} ${won(a.value)} “${a.memo}”`;
    case "Seogilwon.AuthorizationUsed": return html`${tag("서명 송금·결제", "info")} ${addrLink(a.authorizer)} 의 서명이 대납으로 실행됨`;
    case "Seogilwon.MinterConfigured": return html`${tag("발행 한도")} ${addrLink(a.minter)} → ${won(a.minterAllowedAmount)}`;
    case "Seogilwon.MinterRemoved": return html`${tag("발행 담당 해제")} ${addrLink(a.oldMinter)}`;
    case "Seogilwon.Blacklisted": return html`${tag("블랙리스트", "bad")} ${addrLink(a.account)} — ${a.reason}`;
    case "Seogilwon.UnBlacklisted": return html`${tag("블랙리스트 해제", "ok")} ${addrLink(a.account)}`;
    case "Seogilwon.BlackFundsDestroyed": return html`${tag("자금 소각", "bad")} ${addrLink(a.account)} ${won(a.amount)}`;
    case "Seogilwon.Pause": return html`${tag("전체 정지", "bad")} ${a.reason}`;
    case "Seogilwon.Unpause": return html`${tag("정지 해제", "ok")}`;
    case "Seogilwon.ReserveAttested": return html`${tag("준비금 공시", "info")} ${won(a.reserve)}`;
    case "Seogilwon.Upgraded": return html`${tag("업그레이드", "bad")} 서길원의 규칙이 ${addrLink(a.implementation)} 로 바뀜`;
    case "Seogilwon.Clawback": return html`${tag("강제 회수", "bad")} ${addrLink(a.from)} 에서 ${won(a.amount)}`;
    case "Market.ShopOpened": return html`${tag("개점", "info")} ${addrLink(a.owner)} 의 <a href="#/shop/s/${a.shopId}">${a.name}</a>`;
    case "Market.ProductListed": return html`${tag("상품 등록")} <a href="#/shop/p/${a.productId}">${a.name}</a> ${won(a.price)}`;
    case "Market.Purchased": return html`${tag("구매", "ok")} ${addrLink(a.buyer)} → ${addrLink(a.seller)} <a href="#/shop/p/${a.productId}">상품 #${a.productId}</a> × ${a.quantity} = ${won(a.total)}`;
    case "CoinFactory.CoinCreated": return html`${tag("코인 창조", "info")} ${addrLink(a.issuer)} 가 ${a.symbol} (${a.name}) 발행`;
    case "Forwarder.Executed": return html`${tag("대납 중계")} ${addrLink(a.from)} 의 요청을 ${addrLink(a.relayer)} 가 대신 실행`;
    default: return null;
  }
}

export default {
  title: '들여다보기',
  async render(view, params, app) {
    if (!chain.ready) return notReady(view);
    const net = chain.cfg.network;
    render(view, html`
      <div class="page-head"><div><h1>들여다보기</h1><div class="sub">이 거래소에서 일어난 모든 일은 ${net.name} 블록체인에 공개 기록됩니다</div></div></div>
      ${explain('같은 장부를 세 곳에서 확인하기', html`
        <div class="diagram"><span class="node"><b>이 웹사이트</b><br>공개 노드에 직접 질의</span><span class="node"><b>MetaMask</b><br>자기 노드(Infura)로 조회</span>
          <span class="node"><b>이더스캔</b><br>자체 노드로 색인</span><span class="arrow">→ 모두 같은</span><span class="node" style="border-color:var(--accent)"><b>${net.name} 장부</b></span></div>
        <p>아래 거래를 눌러 <b>거래 해부</b>에서 서명·수수료·실행 결과를 보고, 옆의 ‘이더스캔 ↗’로 같은 거래를 외부에서 확인해 보세요. 숫자가 하나라도 다르면 이 웹사이트가 거짓말을 하는 것입니다.</p>
        <p>위 검색창에 닉네임·주소·거래 해시·블록 번호를 넣으면 무엇이든 해부할 수 있습니다.</p>`, { open: true })}
      <div class="card"><div class="card-head"><h2>지금 만들어지는 ${net.name} 블록</h2><span class="muted small">약 12초마다 전 세계 검증자 중 한 명이 블록을 만듭니다. 우리 거래는 그중 일부일 뿐입니다.</span></div><div class="chain-strip" id="strip"></div></div>
      <div class="card"><div class="card-head"><h2>거래소의 모든 기록</h2><span class="muted small">컨트랙트 이벤트 로그를 배포 블록부터 모은 것</span></div><div id="feed" class="loading">불러오는 중…</div></div>
      <div class="card"><h2>거래소 컨트랙트</h2><div class="table-wrap"><table><tbody>
        ${Object.entries(chain.cfg.contracts).map(([n, a]) => html`<tr><td><b>${n}</b></td><td>${addrLink(a, { full: true })}</td><td>${scan('address', a)}</td></tr>`)}
        <tr><td><b>발행자</b></td><td>${addrLink(chain.cfg.issuer, { full: true })}</td><td>${scan('address', chain.cfg.issuer)}</td></tr></tbody></table></div>
        <p class="small muted">컨트랙트 주소를 누르면 체인 위 기계어가 공개 소스코드에서 나온 것인지 직접 대조합니다.</p></div>
    `);

    const strip = async () => {
      const nums = Array.from({ length: 6 }, (_, i) => chain.head - i);
      const blocks = await Promise.all(nums.map((n) => rpc('eth_getBlockByNumber', [E().toQuantity(n), false])));
      render($('#strip', view), html`${blocks.map((b, i) => html`<a class="chain-block" href="#/blocks/${Number(b.number)}" style="text-decoration:none;color:inherit">
        <div class="num">#${fmtNum(Number(b.number))}</div><div class="h">해시 ${short(b.hash, 4, 4)}</div><div class="h">이전 ${short(b.parentHash, 4, 4)}</div>
        <div class="small">거래 ${b.transactions.length}건 · ${timeAgo(b.timestamp)}</div></a>${i < blocks.length - 1 ? html`<div class="chain-link">◀</div>` : ''}`)}`);
    };
    await strip();
    app.onBlock(() => strip().catch(() => {}));

    const items = [];
    for (const n of ['Members', 'Seogilwon', 'Market', 'CoinFactory', 'Forwarder']) {
      const c = await getContract(n);
      for (const { ev, log } of await getEvents(c)) {
        const d = line(n, ev);
        if (d) items.push({ d, log });
      }
    }
    items.sort((a, b) => b.log.blockNumber - a.log.blockNumber || b.log.index - a.log.index);
    const rows = await Promise.all(items.slice(0, 80).map(async ({ d, log }) => html`<tr><td class="small">${timeAgo(await blockTime(log.blockNumber))}</td><td>${blockLink(log.blockNumber)}</td>
      <td>${d}</td><td>${txLink(log.transactionHash)} ${scan('tx', log.transactionHash, '↗')}</td></tr>`));
    render($('#feed', view), rows.length ? html`<div class="table-wrap"><table><thead><tr><th>시각</th><th>블록</th><th>내용</th><th>거래</th></tr></thead><tbody>${rows}</tbody></table></div>`
      : html`<div class="empty">아직 기록이 없습니다</div>`);
  },
};
