import { chain, wallet, getContract, getEvents, writable, connectWallet, switchNetwork, watchToken, loadMembers, blockTime } from '../core/chain.js';
import { isMobile, metamaskDeepLink, html, render, $, fmtUnits, timeAgo, txLink, addrLink, explain, tag, stat, busy, toast, won, scan, errMsg } from '../core/ui.js';
import { readInbox, requestStatus } from '../core/inbox.js';
import { perform, signForward, signTransfer, signNotice, showRelayLink } from '../core/relay.js';

const E = () => globalThis.ethers;

export function notReady(view) {
  render(view, html`<div class="card"><h2>아직 거래소가 문을 열지 않았습니다</h2>
    <p>발행자가 <a href="#/issuer">발행자 · 감독</a> 화면에서 처음 설정(컨트랙트 배포)을 마치면 열립니다.</p></div>`);
}


function walletIntro(view) {
  const net = chain.cfg.network;
  if (!wallet.installed && isMobile()) {
    const deep = metamaskDeepLink();
    render(view, html`
      <div class="hero"><h1>휴대폰에서는 MetaMask 앱 안에서 여세요</h1>
        <p>서길원은 <b>${net.name} 블록체인</b>에 기록되고, 그 돈을 움직이는 열쇠(개인키)는 <b>MetaMask 앱</b>이 보관합니다.
        사파리·크롬·삼성인터넷 같은 일반 인터넷 앱에는 지갑이 없어서 연결할 수 없어요.</p></div>
      <div class="card"><ol class="steps">
        <li><div><b>MetaMask 앱 설치</b><br>앱스토어·플레이스토어에서 <b>MetaMask</b> → 설치 → <b>새 지갑 만들기</b>. 비밀 복구 구문 12단어는 종이에 적어 두세요.</div></li>
        <li><div><b>이 사이트를 MetaMask 앱에서 열기</b><br><a class="btn btn-primary" href="${deep}" style="margin-top:6px">MetaMask 앱에서 열기</a>
          <div class="small muted" style="margin-top:6px">버튼이 안 되면: MetaMask 앱 아래쪽 <b>탐색</b>(돋보기, 버전에 따라 ‘브라우저’) → 위쪽 검색창에 <code>${location.host}${location.pathname}</code></div></div></li>
      </ol></div>`);
    return true;
  }
  if (!wallet.installed) {
    render(view, html`
      <div class="hero"><h1>MetaMask 지갑이 필요합니다</h1>
        <p>서길원은 이 웹사이트가 아니라 <b>${net.name} 블록체인</b>에 기록됩니다. 그 돈을 움직이는 열쇠는 여러분의 <b>MetaMask</b>가 보관합니다.
        같은 잔액을 MetaMask 와 이더스캔에서도 따로 확인할 수 있어요.</p></div>
      <div class="card"><ol class="steps">
        <li><div><b>크롬에 MetaMask 설치</b><br><a href="https://metamask.io/download/" target="_blank" rel="noopener">metamask.io/download</a> → 크롬 확장 프로그램 추가 → <b>새 지갑 만들기</b>. 복구 구문 12단어는 종이에.</div></li>
        <li><div><b>이 페이지 새로고침</b> 후 오른쪽 위 <b>MetaMask 연결</b>. 휴대폰이라면 MetaMask 앱 안에서 여세요 (탐색 → 검색창에 주소).</div></li>
      </ol></div>`);
    return true;
  }
  if (!wallet.address) {
    render(view, html`<div class="hero"><h1>MetaMask 를 연결하세요</h1>
      <p>연결하면 이 웹사이트가 여러분의 <b>지갑 주소</b>를 알게 됩니다. 개인키는 MetaMask 밖으로 나오지 않고, 서명할 때마다 MetaMask 가 확인 창을 띄웁니다.</p>
      <div><button class="btn btn-primary" id="conn">MetaMask 연결</button></div></div>`);
    $('#conn', view).addEventListener('click', (ev) => busy(ev.target, connectWallet));
    return true;
  }
  if (!wallet.chainOk) {
    render(view, html`<div class="hero"><h1>MetaMask 네트워크를 ${net.name} 로 바꿔 주세요</h1>
      <p>이 거래소는 이더리움 공식 시험망 <b>${net.name}</b> 위에 있습니다. 메인넷(진짜 돈)과 장부가 다릅니다.</p>
      <div><button class="btn btn-primary" id="sw">${net.name} 로 전환</button></div>
      <p class="small muted">목록에 없으면: MetaMask → 설정 → 고급 → <b>테스트 네트워크 표시</b> 켜기.</p></div>`);
    $('#sw', view).addEventListener('click', (ev) => busy(ev.target, switchNetwork));
    return true;
  }
  return false;
}

export default {
  title: '내 지갑',
  async render(view, params, app) {
    const draw = async () => {
      if (walletIntro(view)) return;
      if (!chain.ready) return notReady(view);
      const me = wallet.address;
      const net = chain.cfg.network;
      const token = await getContract('Seogilwon');
      const [sgw, eth, black, paused] = await Promise.all([token.balanceOf(me), chain.provider.getBalance(me), token.isBlacklisted(me), token.paused()]);
      const nick = chain.members[me.toLowerCase()]; // 예전에 등록한 이름표가 있으면 표시만
      const isIssuer = me.toLowerCase() === chain.cfg.issuer?.toLowerCase();

      const has = sgw > 0n;
      const tiles = html`<div class="tiles ${has ? '' : 'off'}">
        <a class="tile" href="#/shop"><span class="t-ico">MKT</span><b>상점가 둘러보기</b><span>친구들이 올린 상품을 서길원으로 사기</span></a>
        <a class="tile" href="#/send"><span class="t-ico">SND</span><b>보내기</b><span>친구 주소로 서길원 송금</span></a>
        <a class="tile" href="#/shop/mine"><span class="t-ico">SHP</span><b>내 상점 열기</b><span>상품을 올리고 팔아서 서길원 벌기</span></a>
        <a class="tile" href="#/coins"><span class="t-ico">MNT</span><b>내 코인 만들기</b><span>나만의 포인트를 발행해 보기</span></a>
      </div>`;
      const depForm = (primary) => html`<div class="row" style="margin-top:8px"><input id="depAmt" type="number" min="1" step="1" placeholder="금액 (sgw)" style="flex:1;min-width:110px"><input id="depMemo" placeholder="메모 (선택)" style="flex:1;min-width:110px"><button class="btn ${primary ? 'btn-primary' : ''}" id="dep">입금 신청</button></div>`;

      render(view, html`
        <div class="page-head"><div><h1>${nick ? `${nick} 님의 지갑` : '내 지갑'} ${isIssuer ? tag('발행자', 'info') : ''} ${black ? tag('블랙리스트', 'bad') : ''} ${paused ? tag('전체 거래 정지 중', 'warn') : ''}</h1>
          <div class="sub">${addrLink(me, { full: true, copy: true })} ${scan('address', me)}</div></div></div>

        <div class="balance">
          <div><div class="label">내 서길원</div><div class="amt">${won(sgw)}</div></div>
          <div class="side"><button class="btn small" id="watch">MetaMask 에 표시하기</button>
            <span class="small muted">수수료는 발행사가 냅니다</span></div>
        </div>
        <div id="myReq"></div>

        ${has ? html`
          <div class="card"><h2>이제 써 보세요</h2>${tiles}</div>
          <div class="grid grid-2">
            <div class="card"><h2>입금 신청 <span class="muted small">더 받기 · 원화 → 서길원</span></h2>
              <p class="small muted">신청서에 서명하면 발행자에게 자동으로 가고, 확인되면 서길원이 들어옵니다.</p>${depForm(false)}</div>
            <div class="card"><h2>환매 신청 <span class="muted small">서길원 → 원화</span></h2>
              <p class="small muted">서길원을 발행사에 돌려주면 원화를 돌려받고(블록체인 밖), 발행사는 받은 서길원을 소각합니다.</p>
              <div class="row" style="margin-top:8px"><input id="redAmt" type="number" min="1" step="1" placeholder="금액 (sgw)" style="flex:1;min-width:110px"><button class="btn" id="red">환매 신청</button></div></div>
          </div>`
        : html`
          <div class="card start"><h2>먼저, 입금 신청</h2>
            <p>은행에 원화를 넣었다고 <b>신청서에 서명</b>하면 발행자에게 자동으로 가고, 발행자가 확인하면 그만큼 <b>서길원</b>이 들어옵니다. (실험이라 실제 입금은 안 해도 돼요)</p>
            ${depForm(true)}</div>
          <div class="card"><h2>서길원이 들어오면 할 수 있는 것</h2>${tiles}</div>`}

        <p class="small muted flowline">실제 원화 스테이블코인도 <b>입금 → 발행 → 사용 → 환매 → 소각</b> 순서로 돌아갑니다.</p>

        <div class="card"><div class="card-head"><h2>최근 입출금</h2><a class="small" href="#/address/${me}">전체 보기 →</a></div><div id="hist" class="loading">불러오는 중…</div></div>


        ${explain('MetaMask·이더스캔에서도 똑같이 보이나요?', html`<p>[MetaMask 에 표시하기]를 누르면 MetaMask 의 토큰 목록에 sgw 가 생기고 위와 같은 잔액이 보입니다. ${scan('address', me, '이더스캔')}에서 내 주소를 검색해도 같습니다.
          세 곳이 각자 블록체인 장부를 읽기 때문입니다.</p>`)}
      `);

      // 요청함에 아직 처리 안 된 내 요청이 있으면 위쪽에 알려 줌 (발행자를 기다리는 중이라는 걸 알 수 있게)
      readInbox().then(async ({ items }) => {
        const mine = items.filter((it) => it.v.expected.toLowerCase() === me.toLowerCase());
        const ctx = {};
        const waiting = [];
        for (const it of mine) { const st = await requestStatus(it.obj, it.v, ctx).catch(() => ['bad']); if (st[0] === 'ready' || st[0] === 'wait') waiting.push(it); }
        const el = $('#myReq', view);
        if (!el || !waiting.length) return;
        render(el, html`<div class="verify warn"><div class="vtitle">처리 중 ${waiting.length}건</div>
          <ul class="small" style="margin:6px 0 0;padding-left:18px">${waiting.map((it) => html`<li>${it.obj.label} <span class="muted">· ${timeAgo(it.time)}</span></li>`)}</ul>
          <div class="small muted" style="margin-top:4px">보통 1분 안에 반영됩니다.</div></div>`);
      }).catch(() => {});

      $('#watch', view).addEventListener('click', () => watchToken(chain.cfg.contracts.Seogilwon, 'sgw').then((ok) => ok && toast('MetaMask 에 sgw 를 추가했습니다', 'ok')).catch((e) => toast(errMsg(e), 'bad')));
      const amount = (id) => {
        const v = $(id, view).value.trim();
        if (!/^\d+$/.test(v) || BigInt(v) <= 0n) throw new Error('금액을 1 sgw 이상 정수로 입력하세요');
        return BigInt(v);
      };
      $('#dep', view).addEventListener('click', (ev) => busy(ev.target, async () => {
        const obj = await signNotice(amount('#depAmt'), $('#depMemo', view).value.trim());
        await showRelayLink(obj, { to: '발행자' });
      }));
      $('#red', view)?.addEventListener('click', (ev) => busy(ev.target, async () => {
        const a = amount('#redAmt');
        if (a > sgw) throw new Error(`잔액이 부족합니다 (보유 ${won(sgw)})`);
        const r = await perform({
          label: `환매 신청 ${won(a)}`,
          direct: async () => (await writable(token)).transferWithMemo(chain.cfg.issuer, a, '환매 신청'),
          gasless: () => signTransfer(chain.cfg.issuer, a, `환매 신청 ${won(a)}`),
        });
        if (r.mode === 'direct') await draw();
      }));

      const myTopic = E().zeroPadValue(me, 32);
      const [outs, ins, memos] = await Promise.all([getEvents(token, 'Transfer', [myTopic]), getEvents(token, 'Transfer', [null, myTopic]), getEvents(token, 'Memo')]);
      const memoByTx = Object.fromEntries(memos.map(({ ev, log }) => [log.transactionHash, ev.args.memo]));
      const shopTx = new Set((await getEvents(await getContract('Market'), 'Purchased')).map(({ log }) => log.transactionHash));
      const list = [...outs, ...ins].sort((a, b) => b.log.blockNumber - a.log.blockNumber || b.log.index - a.log.index).slice(0, 15);
      const rows = await Promise.all(list.map(async ({ ev, log }) => {
        const out = ev.args.from.toLowerCase() === me.toLowerCase();
        const other = out ? ev.args.to : ev.args.from;
        const kind = other === E().ZeroAddress ? (out ? '소각' : '발행') : shopTx.has(log.transactionHash) ? (out ? '상점 구매' : '상점 판매') : other.toLowerCase() === chain.cfg.issuer?.toLowerCase() && out ? '환매' : out ? '보냄' : '받음';
        return html`<tr><td class="small">${timeAgo(await blockTime(log.blockNumber))}</td><td>${kind}</td><td>${other === E().ZeroAddress ? '—' : addrLink(other)}</td>
          <td class="num">${out ? '−' : '+'}${won(ev.args.value)}</td><td class="small">${memoByTx[log.transactionHash] || ''}</td><td>${txLink(log.transactionHash)}</td></tr>`;
      }));
      render($('#hist', view), rows.length ? html`<div class="table-wrap"><table><thead><tr><th>시각</th><th>종류</th><th>상대</th><th class="num">금액</th><th>메모</th><th>거래</th></tr></thead><tbody>${rows}</tbody></table></div>`
        : html`<div class="empty">아직 입출금이 없습니다</div>`);
    };
    await draw();
    app.onWallet(() => draw().catch((e) => toast(errMsg(e), 'bad')));
  },
};
