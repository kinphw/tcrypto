import { chain, wallet, getContract, getEvents, writable, track, connectWallet, switchNetwork, watchToken, loadMembers, blockTime } from '../core/chain.js';
import { html, render, $, fmtNum, fmtUnits, timeAgo, short, txLink, addrLink, explain, tag, kv, stat, busy, toast, copyBtn, won, scan, errMsg } from '../core/ui.js';

const E = () => globalThis.ethers;
const STATUS = ['대기 중', '승인', '거절'];

export function notReady(view) {
  render(view, html`<div class="card"><h2>아직 거래소가 문을 열지 않았습니다</h2>
    <p>발행자(창조자)가 <a href="#/issuer">발행자 · 감독</a> 화면에서 처음 설정(컨트랙트 배포)을 마치면 열립니다.</p></div>`);
}

function walletIntro(view) {
  const net = chain.cfg.network;
  if (!wallet.installed && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
    // 휴대폰의 일반 브라우저에는 지갑이 없다 → MetaMask 앱의 내장 브라우저로 이 사이트를 열게 한다
    const deep = `https://metamask.app.link/dapp/${location.host}${location.pathname}`;
    render(view, html`
      <div class="hero"><h1>휴대폰에서는 MetaMask 앱 안에서 여세요</h1>
        <p>이 거래소의 돈은 <b>${net.name} 블록체인</b>에 기록되고, 그 돈을 움직이는 열쇠(개인키)는 <b>MetaMask 앱</b>이 보관합니다.
        일반 인터넷 앱(사파리·크롬·삼성인터넷)에는 지갑이 없어서 연결할 수 없어요.</p></div>
      <div class="card"><ol class="steps">
        <li><div><b>MetaMask 앱 설치</b><br>앱스토어·플레이스토어에서 <b>MetaMask</b> 검색 → 설치 → <b>새 지갑 만들기</b>. 비밀 복구 구문 12단어는 종이에 적어 두세요.</div></li>
        <li><div><b>아래 버튼으로 이 사이트를 MetaMask 앱에서 열기</b><br>
          <a class="btn btn-primary" href="${deep}" style="margin-top:6px">MetaMask 앱에서 열기</a>
          <div class="small muted" style="margin-top:6px">버튼이 안 되면: MetaMask 앱 아래쪽 <b>브라우저</b> 탭 → 주소창에 <code>${location.host}${location.pathname}</code> 입력</div></div></li>
      </ol></div>`);
    return true;
  }
  if (!wallet.installed) {
    render(view, html`
      <div class="hero"><h1>MetaMask 지갑이 필요합니다</h1>
        <p>이 거래소의 돈은 이 웹사이트가 아니라 <b>${net.name} 블록체인</b>에 기록됩니다. 그 돈을 움직이는 열쇠(개인키)는 여러분의 <b>MetaMask 지갑</b>이 보관합니다.
        웹사이트는 화면일 뿐이라, 같은 잔액을 MetaMask 와 이더스캔에서도 따로 확인할 수 있어요.</p></div>
      <div class="card"><ol class="steps">
        <li><div><b>크롬(PC)에 MetaMask 설치</b><br><a href="https://metamask.io/download/" target="_blank" rel="noopener">metamask.io/download</a> → 크롬 확장 프로그램 추가 → <b>새 지갑 만들기</b>.
          비밀 복구 구문 12단어는 종이에 적어 두세요.</div></li>
        <li><div><b>이 페이지 새로고침</b> 후 오른쪽 위 <b>MetaMask 연결</b>.</div></li>
      </ol></div>`);
    return true;
  }
  if (!wallet.address) {
    render(view, html`<div class="hero"><h1>MetaMask 를 연결하세요</h1>
      <p>연결하면 이 웹사이트가 여러분의 <b>지갑 주소</b>를 알게 됩니다. 개인키는 MetaMask 밖으로 나오지 않고, 돈을 보낼 때마다 MetaMask 가 확인 창을 띄웁니다.</p>
      <div><button class="btn btn-primary" id="conn">MetaMask 연결</button></div></div>`);
    $('#conn', view).addEventListener('click', (ev) => busy(ev.target, connectWallet));
    return true;
  }
  if (!wallet.chainOk) {
    render(view, html`<div class="hero"><h1>MetaMask 네트워크를 ${net.name} 로 바꿔 주세요</h1>
      <p>이 거래소는 이더리움 공식 시험망인 <b>${net.name}</b> 위에 있습니다. 메인넷(진짜 돈)과 장부가 다릅니다.</p>
      <div><button class="btn btn-primary" id="sw">${net.name} 로 전환</button></div>
      <p class="small muted">MetaMask 에 ${net.name} 가 안 보이면: MetaMask → 왼쪽 위 네트워크 선택 → <b>테스트 네트워크 보기</b> 켜기.</p></div>`);
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
      const [coin, members] = await Promise.all([getContract('WonCoin'), getContract('Members')]);
      const [krw, eth, nick, frozen] = await Promise.all([coin.balanceOf(me), chain.provider.getBalance(me), members.nameOf(me), coin.frozen(me)]);
      const isIssuer = me.toLowerCase() === chain.cfg.issuer?.toLowerCase();

      render(view, html`
        <div class="page-head"><div><h1>${nick ? `${nick} 님의 지갑` : '내 지갑'} ${isIssuer ? tag('발행자', 'info') : ''} ${frozen ? tag('동결된 계좌', 'bad') : ''}</h1>
          <div class="sub">${addrLink(me, { full: true, copy: true })} ${scan('address', me)}</div></div></div>

        <div class="card">
          <ol class="steps">
            <li class="done"><div><b>MetaMask 연결</b> <span class="muted small">${net.name}</span></div></li>
            <li class="${eth > 0n ? 'done' : ''}"><div><b>수수료용 ${net.currency.symbol} 받기</b> — 블록체인에 무엇을 기록하든 아주 적은 수수료(가스)가 듭니다.
              ${eth > 0n ? html`<span class="muted small">보유 ${fmtUnits(eth, 18, 6)}</span>` : html`<div class="small" style="margin-top:4px">
                내 주소 ${copyBtn(me)} 를 복사해 발행자에게 보내면 조금 나눠 줍니다. 직접 받으려면:
                ${net.faucets.map((f) => html` <a href="${f.url}" target="_blank" rel="noopener">${f.name} ↗</a>`)}</div>`}</div></li>
            <li class="${nick ? 'done' : ''}"><div><b>닉네임으로 가입</b> ${nick ? html`<span class="muted small">${nick}</span>` : html`
              <div class="row" style="margin-top:6px"><input id="nick" maxlength="30" placeholder="닉네임 (나중에 못 바꿉니다)"><button class="btn btn-primary" id="join">가입</button></div>`}</div></li>
            <li class="${krw > 0n ? 'done' : ''}"><div><b>원화코인 충전</b> — 아래에서 충전을 요청하면 발행자가 승인할 때 새로 발행돼 들어옵니다.</div></li>
          </ol>
        </div>

        <div class="stats">
          <div class="stat"><div class="label">서길원 (sgw)</div><div class="big-num">${won(krw)}</div>
            <div class="hint"><button class="btn small" id="watch">MetaMask 에 표시하기</button></div></div>
          ${stat(`수수료용 ${net.currency.symbol}`, fmtUnits(eth, 18, 6), '가스비로만 쓰입니다')}
          ${stat('닉네임', nick || '미가입')}
        </div>
        ${explain('MetaMask 에서 똑같이 보이나요?', html`<p>[MetaMask 에 표시하기]를 누르면 MetaMask 의 <b>토큰</b> 탭에 sgw 가 생기고, 위와 같은 잔액이 보입니다.
          이 웹사이트를 끄고 MetaMask 만 열어도, 또는 ${scan('address', me, '이더스캔')}에서 내 주소를 검색해도 같은 숫자가 나옵니다.
          세 곳이 각자 블록체인 장부를 읽고 있기 때문입니다. 이것이 ‘공동 장부’의 의미입니다.</p>`)}

        <div class="grid grid-2">
          <div class="card">
            <h2>충전 요청</h2>
            <p class="small muted">실제 스테이블코인이라면 은행 계좌로 원화를 입금하고 요청합니다. 여기서는 가상으로 요청만 하면 발행자가 확인 후 승인합니다.</p>
            <div class="row"><input id="depAmt" type="number" min="1" step="1" placeholder="금액 (sgw)" style="flex:1"><input id="depMemo" placeholder="메모 (예: 입금자명)" style="flex:1"><button class="btn btn-primary" id="dep">요청</button></div>
          </div>
          <div class="card">
            <h2>환불(상환) 요청</h2>
            <p class="small muted">요청하는 순간 코인이 원화코인 컨트랙트에 맡겨지고, 발행자가 승인하면 소각(소멸)됩니다. 거절되면 돌려받습니다.</p>
            <div class="row"><input id="redAmt" type="number" min="1" step="1" placeholder="금액 (sgw)" style="flex:1"><input id="redMemo" placeholder="메모 (예: 환불 계좌)" style="flex:1"><button class="btn" id="red">요청</button></div>
          </div>
        </div>

        <div class="card"><h2>내 요청</h2><div id="reqs" class="loading">불러오는 중…</div></div>
        <div class="card"><div class="card-head"><h2>최근 입출금</h2><a class="small" href="#/address/${me}">전체 보기 →</a></div><div id="hist" class="loading">불러오는 중…</div></div>
      `);

      $('#watch', view).addEventListener('click', () => watchToken(chain.cfg.contracts.WonCoin, 'sgw').then((ok) => ok && toast('MetaMask 에 sgw 를 추가했습니다', 'ok')).catch((e) => toast(errMsg(e), 'bad')));
      $('#join', view)?.addEventListener('click', (ev) => busy(ev.target, async () => {
        const n = $('#nick', view).value.trim();
        if (!n) throw new Error('닉네임을 입력하세요');
        if (await members.addrOf(n) !== E().ZeroAddress) throw new Error('이미 누군가 쓰는 닉네임입니다');
        await track((await writable(members)).join(n), '가입');
        await loadMembers();
        await draw();
      }));
      const amount = (id) => {
        const v = $(id, view).value.trim();
        if (!/^\d+$/.test(v) || BigInt(v) <= 0n) throw new Error('금액을 1 sgw 이상 정수로 입력하세요');
        return BigInt(v);
      };
      $('#dep', view).addEventListener('click', (ev) => busy(ev.target, async () => {
        await track((await writable(coin)).requestDeposit(amount('#depAmt'), $('#depMemo', view).value.trim()), '충전 요청');
        await draw();
      }));
      $('#red', view).addEventListener('click', (ev) => busy(ev.target, async () => {
        await track((await writable(coin)).requestRedeem(amount('#redAmt'), $('#redMemo', view).value.trim()), '환불 요청');
        await draw();
      }));

      // 내 요청
      const myTopic = E().zeroPadValue(me, 32);
      const reqs = await getEvents(coin, 'RequestCreated', [null, myTopic]);
      const rows = await Promise.all(reqs.slice().reverse().slice(0, 20).map(async ({ ev, log }) => {
        const r = await coin.requests(ev.args.id);
        return html`<tr><td>${ev.args.redeem ? '환불' : '충전'}</td><td class="num">${won(ev.args.amount)}</td><td class="small">${ev.args.memo}</td>
          <td>${tag(STATUS[Number(r.status)], ['warn', 'ok', 'bad'][Number(r.status)])}</td><td class="small">${timeAgo(Number(r.time))}</td><td>${txLink(log.transactionHash)}</td></tr>`;
      }));
      render($('#reqs', view), rows.length ? html`<div class="table-wrap"><table><thead><tr><th>종류</th><th class="num">금액</th><th>메모</th><th>상태</th><th>시각</th><th>거래</th></tr></thead><tbody>${rows}</tbody></table></div>`
        : html`<div class="empty">아직 요청이 없습니다</div>`);

      // 최근 입출금
      const [outs, ins, memos] = await Promise.all([
        getEvents(coin, 'Transfer', [myTopic]), getEvents(coin, 'Transfer', [null, myTopic]), getEvents(coin, 'Memo'),
      ]);
      const memoByTx = Object.fromEntries(memos.map(({ ev, log }) => [log.transactionHash, ev.args.memo]));
      const shopTx = new Set((await getEvents(await getContract('Market'), 'Purchased')).map(({ log }) => log.transactionHash));
      const list = [...outs, ...ins].sort((a, b) => b.log.blockNumber - a.log.blockNumber || b.log.index - a.log.index).slice(0, 15);
      const hist = await Promise.all(list.map(async ({ ev, log }) => {
        const out = ev.args.from.toLowerCase() === me.toLowerCase();
        const other = out ? ev.args.to : ev.args.from;
        const kind = other === E().ZeroAddress ? (out ? '소각' : '발행') : other.toLowerCase() === chain.cfg.contracts.WonCoin.toLowerCase() ? (out ? '환불 맡김' : '환불 반환') : shopTx.has(log.transactionHash) ? (out ? '상점 구매' : '상점 판매') : out ? '보냄' : '받음';
        return html`<tr><td class="small">${timeAgo(await blockTime(log.blockNumber))}</td><td>${kind}</td><td>${other === E().ZeroAddress ? '—' : addrLink(other)}</td>
          <td class="num" style="color:var(${out ? '--bad' : '--ok'})">${out ? '-' : '+'}${won(ev.args.value)}</td><td class="small">${memoByTx[log.transactionHash] || ''}</td><td>${txLink(log.transactionHash)}</td></tr>`;
      }));
      render($('#hist', view), hist.length ? html`<div class="table-wrap"><table><thead><tr><th>시각</th><th>종류</th><th>상대</th><th class="num">금액</th><th>메모</th><th>거래</th></tr></thead><tbody>${hist}</tbody></table></div>`
        : html`<div class="empty">아직 입출금이 없습니다</div>`);
    };

    await draw();
    app.onWallet(() => draw().catch((e) => toast(errMsg(e), 'bad')));
  },
};
