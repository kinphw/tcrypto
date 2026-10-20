import { chain, wallet, getContract, getEvents, writable, blockTime } from '../core/chain.js';
import { html, render, $, fmtNum, timeAgo, txLink, addrLink, explain, busy, won, esc } from '../core/ui.js';
import { perform, signTransfer, signForward, feeMode } from '../core/relay.js';
import { notReady } from './home.js';

const E = () => globalThis.ethers;

/** 닉네임이나 0x 주소 → 주소 */
export function resolveRecipient(q) {
  q = q.trim();
  if (E().isAddress(q)) return E().getAddress(q);
  const hit = Object.entries(chain.members).find(([, n]) => n === q);
  if (hit) return E().getAddress(hit[0]);
  throw new Error(`'${q}' 라는 이름표가 없습니다. 이름이나 0x 주소를 입력하세요.`);
}

/** 내가 보유한 코인 목록: 박형원 + 보유 중인 친구 코인 */
export async function myCoins(me) {
  const sgw = await getContract('Seogilwon');
  const list = [{ address: chain.cfg.contracts.Seogilwon, symbol: 'sgw', name: '박형원', balance: me ? await sgw.balanceOf(me) : 0n, official: true }];
  const f = await getContract('CoinFactory');
  for (const a of await f.allCoins()) {
    const c = await getContract('FriendCoin', a);
    const bal = me ? await c.balanceOf(me) : 0n;
    if (bal > 0n) list.push({ address: a, symbol: await c.symbol(), name: await c.name(), balance: bal, official: false });
  }
  return list;
}

export default {
  title: '송금',
  async render(view, params, app) {
    if (!chain.ready) return notReady(view);
    const me = wallet.address;
    const coins = await myCoins(me);
    const names = Object.values(chain.members);

    render(view, html`
      <div class="page-head"><div><h1>송금</h1><div class="sub">닉네임이나 주소로 코인을 보냅니다</div></div></div>
      <div class="card">
        <div class="field"><label for="to">받는 사람</label><input id="to" list="memberList" placeholder="닉네임 또는 0x 주소" value="${params[0] || ''}">
          <datalist id="memberList">${names.map((n) => html`<option value="${n}"></option>`)}</datalist></div>
        <div class="row">
          <div class="field" style="flex:1;min-width:160px"><label for="coin">코인</label><select id="coin">${coins.map((c) => html`<option value="${c.address}">${c.symbol} — 보유 ${fmtNum(c.balance)}</option>`)}</select></div>
          <div class="field" style="flex:1;min-width:140px"><label for="amt">금액</label><input id="amt" type="number" min="1" step="1" placeholder="숫자만"></div>
        </div>
        <div class="field"><label for="memo">메모 (블록체인에 영구 기록, 누구나 볼 수 있음)</label><input id="memo" maxlength="100" placeholder="예: 점심값"></div>
        <div id="preview" class="small muted" style="margin-bottom:10px"></div>
        <button class="btn btn-primary" id="send" ${me ? '' : 'disabled'}>보내기</button>
        ${me ? '' : html`<p class="small muted" style="margin-top:6px">먼저 <a href="#/home">MetaMask 를 연결</a>하세요.</p>`}
      </div>
      ${explain('보내기를 누르면 무슨 일이?', html`<p>MetaMask 에서 “내 박형원을 이 사람에게 보내도 된다”에 <b>서명</b>만 하면 됩니다(USDC 와 같은 EIP-3009 방식). 수수료는 발행사가 내고 블록체인에 올립니다.
        블록에 담기면 박형원 프로그램이 장부의 두 칸(내 잔액 −, 상대 잔액 +)을 고칩니다. 은행 없이 이체가 끝납니다.</p>`)}
      <div class="card"><h2>최근 송금 (전체 공개)</h2><div id="recent" class="loading">불러오는 중…</div></div>
    `);

    const updatePreview = () => {
      try {
        const to = resolveRecipient($('#to', view).value);
        $('#preview', view).innerHTML = `받는 주소: <span class="hash">${esc(to)}</span> ${esc(chain.members[to.toLowerCase()] ? '(' + chain.members[to.toLowerCase()] + ')' : '(이름표 없는 주소)')}`;
      } catch { $('#preview', view).textContent = ''; }
    };
    $('#to', view).addEventListener('input', updatePreview);
    updatePreview();

    $('#send', view).addEventListener('click', (ev) => busy(ev.target, async () => {
      const to = resolveRecipient($('#to', view).value);
      if (to.toLowerCase() === me.toLowerCase()) throw new Error('나에게는 보낼 수 없습니다');
      const v = $('#amt', view).value.trim();
      if (!/^\d+$/.test(v) || BigInt(v) <= 0n) throw new Error('금액을 1 이상 정수로 입력하세요');
      const coinAddr = $('#coin', view).value;
      const memo = $('#memo', view).value.trim();
      const isSgw = coinAddr === chain.cfg.contracts.Seogilwon;
      const c = isSgw ? await getContract('Seogilwon') : await getContract('FriendCoin', coinAddr);
      const sym = isSgw ? 'sgw' : await c.symbol();
      const label = `${chain.members[to.toLowerCase()] || to.slice(0, 8)} 에게 ${BigInt(v).toLocaleString()} ${sym}`;
      const r = await perform({
        label,
        direct: async () => (await writable(c)).transferWithMemo(to, BigInt(v), memo),
        gasless: () => (isSgw ? signTransfer(to, BigInt(v), label) : signForward(c, 'transferWithMemo', [to, BigInt(v), memo], label)),
      });
      if (r.mode === 'direct' && r.receipt.status === 1) location.hash = `#/tx/${r.receipt.hash}`;
    }));

    const coin = await getContract('Seogilwon');
    const [transfers, memos] = await Promise.all([getEvents(coin, 'Transfer'), getEvents(coin, 'Memo')]);
    const memoByTx = Object.fromEntries(memos.map(({ ev, log }) => [log.transactionHash, ev.args.memo]));
    const peer = transfers.filter(({ ev }) => ev.args.from !== E().ZeroAddress && ev.args.to !== E().ZeroAddress);
    const rows = await Promise.all(peer.slice().reverse().slice(0, 20).map(async ({ ev, log }) => html`<tr>
      <td class="small">${timeAgo(await blockTime(log.blockNumber))}</td><td>${addrLink(ev.args.from)} → ${addrLink(ev.args.to)}</td>
      <td class="num">${won(ev.args.value)}</td><td class="small">${memoByTx[log.transactionHash] || ''}</td><td>${txLink(log.transactionHash)}</td></tr>`));
    render($('#recent', view), rows.length ? html`<div class="table-wrap"><table><thead><tr><th>시각</th><th>보낸 사람 → 받는 사람</th><th class="num">금액</th><th>메모</th><th>거래</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="small muted">블록체인은 공개 장부라 모든 송금이 누구에게나 보입니다. 이름 대신 닉네임·주소만 있을 뿐입니다(가명성).</p>`
      : html`<div class="empty">아직 송금이 없습니다</div>`);
  },
};
