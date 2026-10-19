import { chain, wallet, getContract, getEvents, writable, track, watchToken } from '../core/chain.js';
import { html, render, $, $$, fmtNum, addrLink, explain, tag, busy, toast, txLink, errMsg } from '../core/ui.js';
import { notReady } from './home.js';
import { perform, signForward } from '../core/relay.js';
import { resolveRecipient } from './send.js';

const E = () => globalThis.ethers;

const mod = {
  title: '내 코인 발행',
  async render(view, params, app) {
    if (!chain.ready) return notReady(view);
    const me = wallet.address;
    const f = await getContract('CoinFactory');
    const created = await getEvents(f, 'CoinCreated');
    const coins = await Promise.all(created.map(async ({ ev, log }) => {
      const c = await getContract('FriendCoin', ev.args.coin);
      const [supply, mine] = await Promise.all([c.totalSupply(), me ? c.balanceOf(me) : 0n]);
      return { address: ev.args.coin, issuer: ev.args.issuer, name: ev.args.name, symbol: ev.args.symbol, supply, mine, tx: log.transactionHash, c };
    }));

    render(view, html`
      <div class="page-head"><div><h1>내 코인 발행</h1><div class="sub">누구나 자기 이름의 코인을 만들어 발행자가 될 수 있습니다</div></div></div>
      ${explain('서길원과 무엇이 다른가', html`<ul>
        <li><b>서길원(sgw)</b>: 입금 신청 → 발행 담당이 한도 안에서 발행. 블랙리스트·정지·업그레이드 같은 통제 장치와 준비금 공시가 있고 상점 결제에 쓰입니다.</li>
        <li><b>내 코인</b>: 버튼 하나로 생기고, 만든 사람이 원하는 만큼 마음대로 찍어낼 수 있습니다. 담보도, 발행 한도도, 차단 장치도 없습니다.</li>
      </ul><p>둘 다 똑같은 ERC-20 토큰이라 MetaMask·이더스캔에서는 구별 없이 ‘토큰’으로 보입니다. 이름만 보고는 믿을 수 있는 코인인지 알 수 없다는 점이 감독의 핵심 고민입니다.</p>`, { open: true })}
      <div class="card"><div class="card-head"><h2>새 코인 만들기</h2></div>
        <div class="row"><input id="cName" maxlength="20" placeholder="이름 (예: 철수포인트)" style="flex:2;min-width:160px"><input id="cSym" maxlength="11" placeholder="기호 (예: CSP)" style="width:120px">
          <input id="cSupply" type="number" min="0" step="1" placeholder="처음 발행량" style="width:140px"><button class="btn btn-primary" id="create" ${me ? '' : 'disabled'}>발행</button></div>
        <p class="small muted" style="margin-top:6px">코인공장 컨트랙트가 새 코인 컨트랙트를 만들어 줍니다. 처음 발행량은 전부 내 지갑으로 들어옵니다.</p></div>
      <div class="card"><h2>모든 코인 (${coins.length}개)</h2>
        ${coins.length ? html`<div class="table-wrap"><table><thead><tr><th>코인</th><th>발행자</th><th class="num">총 발행량</th><th class="num">내 보유</th><th></th></tr></thead><tbody>
          ${coins.slice().reverse().map((c) => html`<tr data-coin="${c.address}"><td><b>${c.symbol}</b> <span class="muted">${c.name}</span><br>${addrLink(c.address)}</td><td>${addrLink(c.issuer)}</td>
            <td class="num">${fmtNum(c.supply)}</td><td class="num">${fmtNum(c.mine)}</td>
            <td><div class="row">${c.mine > 0n ? html`<a class="btn small" href="#/send">보내기</a>` : ''}<button class="btn small" data-watch="${c.symbol}">MetaMask 표시</button></div>
            ${me && c.issuer.toLowerCase() === me.toLowerCase() ? html`<div class="row" style="margin-top:6px"><input data-to placeholder="받는 닉네임/주소" style="width:140px"><input data-amt type="number" min="1" placeholder="수량" style="width:90px"><button class="btn small btn-primary" data-mint>추가 발행</button></div>` : ''}</td></tr>`)}
        </tbody></table></div>` : html`<div class="empty">아직 아무도 코인을 만들지 않았습니다</div>`}</div>
    `);

    $('#create', view).addEventListener('click', (ev) => busy(ev.target, async () => {
      const n = $('#cName', view).value.trim(), s = $('#cSym', view).value.trim(), q = $('#cSupply', view).value.trim() || '0';
      if (!n || !s) throw new Error('이름과 기호를 입력하세요');
      if (!/^\d+$/.test(q)) throw new Error('발행량은 0 이상 정수');
      const r = await perform({ label: `코인 만들기: ${s}`, direct: async () => (await writable(f)).createCoin(n, s, BigInt(q)), gasless: () => signForward(f, 'createCoin', [n, s, BigInt(q)], `코인 만들기: ${s} (${n})`) });
      if (r.mode !== 'direct') return;
      await mod.render(view, params, app);
    }));
    for (const row of $$('[data-coin]', view)) {
      const c = coins.find((x) => x.address === row.dataset.coin);
      row.querySelector('[data-watch]').addEventListener('click', () => watchToken(c.address, c.symbol).catch((e) => toast(errMsg(e), 'bad')));
      row.querySelector('[data-mint]')?.addEventListener('click', (ev) => busy(ev.target, async () => {
        const to = resolveRecipient(row.querySelector('[data-to]').value);
        const amt = row.querySelector('[data-amt]').value.trim();
        if (!/^\d+$/.test(amt) || BigInt(amt) <= 0n) throw new Error('수량을 1 이상 정수로');
        const r = await perform({ label: `${c.symbol} 추가 발행`, direct: async () => (await writable(c.c)).mint(to, BigInt(amt), ''), gasless: () => signForward(c.c, 'mint', [to, BigInt(amt), ''], `${c.symbol} ${amt}개 추가 발행`) });
        if (r.mode !== 'direct') return;
        await mod.render(view, params, app);
      }));
    }
  },
};
export default mod;
