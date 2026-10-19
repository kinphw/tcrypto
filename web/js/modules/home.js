import { chain, wallet, getContract, getEvents, writable, connectWallet, switchNetwork, watchToken, loadMembers, blockTime } from '../core/chain.js';
import { html, render, $, fmtUnits, timeAgo, txLink, addrLink, explain, tag, stat, busy, toast, won, scan, errMsg } from '../core/ui.js';
import { perform, signForward, signTransfer, signNotice, showRelayLink, getFeePref, setFeePref, feeMode } from '../core/relay.js';

const E = () => globalThis.ethers;

export function notReady(view) {
  render(view, html`<div class="card"><h2>아직 거래소가 문을 열지 않았습니다</h2>
    <p>발행자가 <a href="#/issuer">발행자 · 감독</a> 화면에서 처음 설정(컨트랙트 배포)을 마치면 열립니다.</p></div>`);
}

/** 수수료 방식 선택: 자동 / 내가 냄 / 대납 요청 */
export function feeToggle(onChange) {
  const pref = getFeePref();
  const opt = [['auto', '자동'], ['direct', '내가 냄'], ['gasless', '대납 요청']];
  const el = document.createElement('div');
  el.className = 'seg';
  el.innerHTML = opt.map(([k, l]) => `<button data-m="${k}" class="${pref === k ? 'on' : ''}">${l}</button>`).join('');
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    setFeePref(b.dataset.m);
    el.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    onChange?.();
  });
  return el;
}

function walletIntro(view) {
  const net = chain.cfg.network;
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (!wallet.installed && mobile) {
    const deep = `https://metamask.app.link/dapp/${location.host}${location.pathname}`;
    render(view, html`
      <div class="hero"><h1>휴대폰에서는 MetaMask 앱 안에서 여세요</h1>
        <p>서길원은 <b>${net.name} 블록체인</b>에 기록되고, 그 돈을 움직이는 열쇠(개인키)는 <b>MetaMask 앱</b>이 보관합니다.
        사파리·크롬·삼성인터넷 같은 일반 인터넷 앱에는 지갑이 없어서 연결할 수 없어요.</p></div>
      <div class="card"><ol class="steps">
        <li><div><b>MetaMask 앱 설치</b><br>앱스토어·플레이스토어에서 <b>MetaMask</b> → 설치 → <b>새 지갑 만들기</b>. 비밀 복구 구문 12단어는 종이에 적어 두세요.</div></li>
        <li><div><b>이 사이트를 MetaMask 앱에서 열기</b><br><a class="btn btn-primary" href="${deep}" style="margin-top:6px">MetaMask 앱에서 열기</a>
          <div class="small muted" style="margin-top:6px">버튼이 안 되면: MetaMask 앱 아래쪽 <b>브라우저</b> 탭 → 주소창에 <code>${location.host}${location.pathname}</code></div></div></li>
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
        <li><div><b>이 페이지 새로고침</b> 후 오른쪽 위 <b>MetaMask 연결</b>. 휴대폰이라면 MetaMask 앱의 브라우저 탭에서 여세요.</div></li>
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
      const [token, members] = await Promise.all([getContract('Seogilwon'), getContract('Members')]);
      const [sgw, eth, nick, black, paused] = await Promise.all([token.balanceOf(me), chain.provider.getBalance(me), members.nameOf(me), token.isBlacklisted(me), token.paused()]);
      const isIssuer = me.toLowerCase() === chain.cfg.issuer?.toLowerCase();
      const mode = await feeMode();

      render(view, html`
        <div class="page-head"><div><h1>${nick ? `${nick} 님의 지갑` : '내 지갑'} ${isIssuer ? tag('발행자', 'info') : ''} ${black ? tag('블랙리스트', 'bad') : ''} ${paused ? tag('전체 거래 정지 중', 'warn') : ''}</h1>
          <div class="sub">${addrLink(me, { full: true, copy: true })} ${scan('address', me)}</div></div></div>

        <div class="stats">
          <div class="stat"><div class="label">서길원 sgw</div><div class="big-num">${won(sgw)}</div><div class="hint"><button class="btn small" id="watch">MetaMask 에 표시하기</button></div></div>
          ${stat(`수수료용 ${net.currency.symbol}`, fmtUnits(eth, 18, 6), eth > 0n ? '직접 거래할 때 씀' : '없어도 대납으로 사용 가능')}
          ${stat('닉네임', nick || '미가입')}
        </div>

        <div class="card">
          <div class="card-head"><h2>수수료 방식</h2><span id="feeSeg"></span><span class="small muted">지금: <b>${mode === 'direct' ? '내가 ETH 로 냄' : '서명만 하고 대납 요청'}</b></span></div>
          <p class="small muted">블록체인에 무엇을 기록하든 ETH 수수료가 듭니다. <b>대납 요청</b>을 고르면 MetaMask 로 서명만 하고(수수료 0), 서명을 담은 링크를 발행자에게 보내 대신 올리게 합니다. 실제 USDC 의 ‘수수료 없는 송금’과 같은 구조입니다.
            <b>자동</b>은 ETH 가 있으면 직접, 없으면 대납입니다.</p>
        </div>

        <div class="card">
          <ol class="steps">
            <li class="done"><div><b>MetaMask 연결</b> <span class="muted small">${net.name}</span></div></li>
            <li class="${nick ? 'done' : ''}"><div><b>닉네임으로 가입</b> ${nick ? html`<span class="muted small">${nick}</span>` : html`
              <div class="row" style="margin-top:6px"><input id="nick" maxlength="30" placeholder="닉네임 (나중에 못 바꿉니다)"><button class="btn btn-primary" id="join">가입</button></div>`}</div></li>
            <li class="${sgw > 0n ? 'done' : ''}"><div><b>입금 신고 → 발행</b><br><span class="small">실제 스테이블코인처럼, 은행에 원화를 넣었다고 <b>신고서에 서명</b>해 발행자에게 보내면 발행자가 확인 후 발행합니다. 신고서는 블록체인에 올라가지 않아 수수료가 없습니다.</span>
              <div class="row" style="margin-top:6px"><input id="depAmt" type="number" min="1" step="1" placeholder="금액 (sgw)" style="flex:1;min-width:110px"><input id="depMemo" placeholder="메모 (예: 입금자명)" style="flex:1;min-width:120px"><button class="btn btn-primary" id="dep">신고서 서명</button></div></div></li>
            <li><div><b>사용하기</b> — <a href="#/send">송금</a> · <a href="#/shop">상점가</a> · <a href="#/coins">내 코인 발행</a></div></li>
          </ol>
        </div>

        <div class="card">
          <h2>상환 (서길원 → 원화)</h2>
          <p class="small muted">발행사 주소(${addrLink(chain.cfg.issuer)})로 서길원을 보내면, 발행사가 원화를 돌려주고(블록체인 밖) 받은 서길원을 소각합니다. USDC 의 상환과 같은 흐름입니다.</p>
          <div class="row"><input id="redAmt" type="number" min="1" step="1" placeholder="금액 (sgw)" style="flex:1;min-width:110px"><button class="btn" id="red">상환 요청</button></div>
        </div>

        ${explain('MetaMask·이더스캔에서도 똑같이 보이나요?', html`<p>[MetaMask 에 표시하기]를 누르면 MetaMask 의 토큰 목록에 sgw 가 생기고 위와 같은 잔액이 보입니다. ${scan('address', me, '이더스캔')}에서 내 주소를 검색해도 같습니다.
          세 곳이 각자 블록체인 장부를 읽기 때문입니다.</p>`)}

        <div class="card"><div class="card-head"><h2>최근 입출금</h2><a class="small" href="#/address/${me}">전체 보기 →</a></div><div id="hist" class="loading">불러오는 중…</div></div>
      `);
      $('#feeSeg', view).appendChild(feeToggle(() => draw()));

      $('#watch', view).addEventListener('click', () => watchToken(chain.cfg.contracts.Seogilwon, 'sgw').then((ok) => ok && toast('MetaMask 에 sgw 를 추가했습니다', 'ok')).catch((e) => toast(errMsg(e), 'bad')));
      $('#join', view)?.addEventListener('click', (ev) => busy(ev.target, async () => {
        const n = $('#nick', view).value.trim();
        if (!n) throw new Error('닉네임을 입력하세요');
        if (await members.addrOf(n) !== E().ZeroAddress) throw new Error('이미 누군가 쓰는 닉네임입니다');
        const r = await perform({
          label: `가입: ${n}`,
          direct: async () => (await writable(members)).join(n),
          gasless: () => signForward(members, 'join', [n], `가입: ${n}`),
        });
        if (r.mode === 'direct') { await loadMembers(); await draw(); }
      }));
      const amount = (id) => {
        const v = $(id, view).value.trim();
        if (!/^\d+$/.test(v) || BigInt(v) <= 0n) throw new Error('금액을 1 sgw 이상 정수로 입력하세요');
        return BigInt(v);
      };
      $('#dep', view).addEventListener('click', (ev) => busy(ev.target, async () => {
        const obj = await signNotice(amount('#depAmt'), $('#depMemo', view).value.trim());
        await showRelayLink(obj, { to: '발행자' });
      }));
      $('#red', view).addEventListener('click', (ev) => busy(ev.target, async () => {
        const a = amount('#redAmt');
        if (a > sgw) throw new Error(`잔액이 부족합니다 (보유 ${won(sgw)})`);
        const r = await perform({
          label: `상환 요청 ${won(a)}`,
          direct: async () => (await writable(token)).transferWithMemo(chain.cfg.issuer, a, '상환 요청'),
          gasless: () => signTransfer(chain.cfg.issuer, a, `상환 요청 ${won(a)}`),
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
        const kind = other === E().ZeroAddress ? (out ? '소각' : '발행') : shopTx.has(log.transactionHash) ? (out ? '상점 구매' : '상점 판매') : other.toLowerCase() === chain.cfg.issuer?.toLowerCase() && out ? '상환' : out ? '보냄' : '받음';
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
