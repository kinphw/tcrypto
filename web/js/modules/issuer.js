import { chain, wallet, rpc, getContract, getEvents, writable, track, artifact, requireWallet, waitReceipt, saveLocalDeployment, loadMembers, blockTime } from '../core/chain.js';
import { html, render, $, $$, fmtNum, fmtUnits, fmtTime, timeAgo, short, txLink, addrLink, explain, tag, kv, stat, busy, toast, won, scan, copyBtn } from '../core/ui.js';
import { resolveRecipient } from './send.js';

const E = () => globalThis.ethers;
const ROLES = { MINTER: '발행 담당', COMPLIANCE: '준법 담당', PAUSER: '정지 담당' };
const ROLE_OF = Object.fromEntries(Object.keys(ROLES).map((k) => [E().id(k), k]));

function describe(ev) {
  const a = ev.args;
  switch (ev.name) {
    case 'RequestCreated': return html`${tag(a.redeem ? '환불 요청' : '충전 요청', 'warn')} ${addrLink(a.user)} ${won(a.amount)} — “${a.memo}”`;
    case 'RequestResolved': return html`${tag(a.approved ? '승인' : '거절', a.approved ? 'ok' : 'bad')} ${addrLink(a.by)} 가 ${addrLink(a.user)} 의 ${a.redeem ? '환불' : '충전'} ${won(a.amount)} ${a.approved ? '승인' : '거절'} ${a.note ? `— “${a.note}”` : ''}`;
    case 'Minted': return html`${tag('발행', 'ok')} ${addrLink(a.to)} 에게 <b>${won(a.amount)}</b> 새로 발행 ${a.memo ? `— “${a.memo}”` : ''}`;
    case 'Burned': return html`${tag('소각', 'warn')} ${addrLink(a.from)} 의 <b>${won(a.amount)}</b> 소각 ${a.memo ? `— “${a.memo}”` : ''}`;
    case 'Frozen': return html`${tag('동결', 'bad')} ${addrLink(a.account)} — “${a.reason}”`;
    case 'Unfrozen': return html`${tag('동결 해제', 'ok')} ${addrLink(a.account)} — “${a.reason}”`;
    case 'FrozenFundsWiped': return html`${tag('강제 소각', 'bad')} ${addrLink(a.account)} 의 <b>${won(a.amount)}</b> — “${a.reason}”`;
    case 'Paused': return html`${tag('전체 정지', 'bad')} — “${a.reason}”`;
    case 'Unpaused': return html`${tag('정지 해제', 'ok')} — “${a.reason}”`;
    case 'RoleChanged': return html`${tag('권한', 'info')} ${addrLink(a.account)} ${ROLES[ROLE_OF[a.role]] || short(a.role)} ${a.granted ? '부여' : '회수'}`;
    case 'ReserveAttested': return html`${tag('준비금 공시', 'info')} 준비자산 ${won(a.reserve)} / 당시 발행량 ${won(a.supplyAtTime)} — 근거: ${a.evidence}`;
    case 'OwnershipTransferred': return html`${tag('소유권', 'info')} ${addrLink(a.previousOwner)} → ${addrLink(a.newOwner)}`;
    default: return null;
  }
}

// ───────── 처음 설정: 발행자가 MetaMask 로 컨트랙트 4개 배포 ─────────
async function renderSetup(view) {
  render(view, html`
    <div class="page-head"><div><h1>처음 설정 (발행자 전용)</h1><div class="sub">${chain.cfg.network.name} 에 실험실 컨트랙트 4개를 배포합니다</div></div></div>
    <div class="card">
      <p>지금 MetaMask 에 연결된 주소가 <b>발행자</b>가 됩니다. 원화코인의 발행·동결 권한이 이 주소에 생깁니다.</p>
      <ol class="steps">
        <li><div><b>명부(Members)</b> — 닉네임 가입</div></li>
        <li><div><b>원화코인(WonCoin)</b> — 충전·환불·동결·준비금 공시</div></li>
        <li><div><b>상점가(Market)</b> — 상점·상품·구매 (원화코인 주소를 알려줘야 하므로 2번 다음)</div></li>
        <li><div><b>코인공장(CoinFactory)</b> — 누구나 내 코인 만들기</div></li>
      </ol>
      <p class="small muted">MetaMask 승인 창이 4번 뜹니다. 각각 배포 거래이며, 수수료로 시험용 ETH 가 조금 듭니다.</p>
      <button class="btn btn-primary" id="deploy">MetaMask 로 배포 시작</button>
      <div id="out" style="margin-top:12px"></div>
    </div>`);
  $('#deploy', view).addEventListener('click', (ev) => busy(ev.target, async () => {
    const signer = requireWallet();
    const deployBlock = Number(await rpc('eth_blockNumber'));
    const out = {};
    const log = (s) => $('#out', view).insertAdjacentHTML('beforeend', `<div class="small">${s}</div>`);
    for (const [name, args] of [['Members', []], ['WonCoin', []], ['Market', () => [out.WonCoin]], ['CoinFactory', []]]) {
      const a = await artifact(name);
      log(`${name} 배포: MetaMask 에서 승인하세요…`);
      const c = await new (E().ContractFactory)(a.abi, a.bytecode, signer).deploy(...(typeof args === 'function' ? args() : args));
      const r = await waitReceipt(c.deploymentTransaction().hash);
      if (r.status !== 1) throw new Error(`${name} 배포 실패`);
      out[name] = E().getAddress(r.contractAddress);
      log(`✔ ${name} → ${out[name]}`);
    }
    const d = { chainId: chain.cfg.network.chainId, issuer: wallet.address, contracts: out, deployBlock };
    saveLocalDeployment(d);
    const json = JSON.stringify({ issuer: d.issuer, contracts: d.contracts, deployBlock: d.deployBlock }, null, 2);
    render($('#out', view), html`<div class="verify ok"><div class="vtitle">${tag('완료', 'ok')} 배포가 끝났습니다</div>
      <p class="small">이 브라우저에서는 바로 사용할 수 있습니다. <b>다른 사람들도 쓰려면</b> 아래 내용을 웹사이트 설정 파일(<code>app-config.json</code>)에 넣어야 합니다 — Claude 에게 “배포 끝났어”라고 말하면 반영해 드립니다.</p>
      <pre class="code">${json}</pre>${copyBtn(json)}</div>
      <p><button class="btn btn-primary" onclick="location.reload()">실험실 열기</button></p>`);
  }));
}

export default {
  title: '발행자 · 감독',
  async render(view, params, app) {
    if (!chain.ready) {
      if (!wallet.address) return render(view, html`<div class="card"><h2>처음 설정</h2><p>실험실 컨트랙트가 아직 없습니다. 발행자가 될 사람이 오른쪽 위 <b>MetaMask 연결</b> 후 이 화면에서 배포하세요.</p></div>`);
      return renderSetup(view);
    }
    const coin = await getContract('WonCoin');
    const market = await getContract('Market');
    const members = await getContract('Members');
    const me = wallet.address;

    const draw = async () => {
      const [supply, paused, owner, nReq, nAtt, nMembers, nShops, nProducts, nOrders] = await Promise.all([
        coin.totalSupply(), coin.paused(), coin.owner(), coin.requestCount(), coin.attestationCount(), members.count(), market.shopCount(), market.productCount(), market.orderCount(),
      ]);
      const myRoles = me ? (await Promise.all(Object.keys(ROLES).map(async (r) => ((await coin.hasRole(E().id(r), me)) ? r : null)))).filter(Boolean) : [];
      const isOwner = me && owner.toLowerCase() === me.toLowerCase();
      const all = await getEvents(coin);
      const purchases = await getEvents(market, 'Purchased');
      const volume = purchases.reduce((a, { ev }) => a + ev.args.total, 0n);
      const last = nAtt > 0n ? await coin.attestations(nAtt - 1n) : null;
      const cover = last && supply > 0n ? Number((last.reserve * 10000n) / supply) / 100 : null;

      // 대기 요청
      const pendingIds = [];
      for (let i = Number(nReq) - 1; i >= 0 && pendingIds.length < 50; i--) {
        const r = await coin.requests(i);
        if (Number(r.status) === 0) pendingIds.push({ id: i, r });
      }
      // 회원별 잔액 (Transfer 재생)
      const bal = new Map();
      const frozen = new Set();
      for (const { ev } of all) {
        if (ev.name === 'Transfer') {
          const { from, to, value } = ev.args;
          if (from !== E().ZeroAddress) bal.set(from, (bal.get(from) || 0n) - value);
          if (to !== E().ZeroAddress) bal.set(to, (bal.get(to) || 0n) + value);
        }
        if (ev.name === 'Frozen') frozen.add(ev.args.account);
        if (ev.name === 'Unfrozen') frozen.delete(ev.args.account);
      }
      const holders = [...bal.entries()].filter(([a, v]) => v > 0n && a.toLowerCase() !== chain.cfg.contracts.WonCoin.toLowerCase()).sort((a, b) => (b[1] > a[1] ? 1 : -1));
      const escrow = bal.get(E().getAddress(chain.cfg.contracts.WonCoin)) || 0n;
      const can = (r) => myRoles.includes(r);

      render(view, html`
        <div class="page-head"><div><h1>발행자 · 감독</h1><div class="sub">원화코인 컨트랙트 ${addrLink(chain.cfg.contracts.WonCoin)} ${scan('token', chain.cfg.contracts.WonCoin)}</div></div></div>
        ${me ? html`<p class="small">내 권한: ${isOwner ? tag('소유자', 'info') : ''} ${myRoles.map((r) => tag(ROLES[r], 'info'))} ${!isOwner && !myRoles.length ? html`<span class="muted">없음 — 이 화면을 볼 수는 있지만 조치 버튼은 거절됩니다</span>` : ''}</p>` : ''}

        <div class="stats">
          ${stat('총 발행량', won(supply), paused ? '⛔ 전체 거래 정지 중' : '정상 유통')}
          ${stat('최근 준비금 비율', cover == null ? '공시 없음' : cover.toFixed(1) + '%', last ? `${won(last.reserve)} / 현재 발행 ${won(supply)}` : '')}
          ${stat('회원', fmtNum(nMembers) + '명', `원화 보유 ${holders.length}명`)}
          ${stat('상점 · 상품', `${fmtNum(nShops)} · ${fmtNum(nProducts)}`, `주문 ${fmtNum(nOrders)}건, 거래액 ${won(volume)}`)}
          ${stat('대기 중 요청', fmtNum(pendingIds.length) + '건', escrow ? `환불 보관 중 ${won(escrow)}` : '')}
        </div>

        <div class="card"><div class="card-head"><h2>대기 중인 충전·환불 요청</h2></div>
          ${pendingIds.length ? html`<div class="table-wrap"><table><thead><tr><th>#</th><th>요청자</th><th>종류</th><th class="num">금액</th><th>메모</th><th>시각</th><th></th></tr></thead><tbody>
            ${pendingIds.map(({ id, r }) => html`<tr data-req="${id}"><td>${id}</td><td>${addrLink(r.user)}</td><td>${r.redeem ? tag('환불', 'warn') : tag('충전', 'info')}</td><td class="num">${won(r.amount)}</td>
              <td class="small">${r.memo}</td><td class="small">${timeAgo(Number(r.time))}</td>
              <td><div class="row"><button class="btn small btn-primary" data-ok ${can('MINTER') ? '' : 'disabled'}>승인</button><button class="btn small" data-no ${can('MINTER') ? '' : 'disabled'}>거절</button></div></td></tr>`)}
          </tbody></table></div>` : html`<div class="empty">대기 중인 요청이 없습니다</div>`}
          <p class="small muted">충전 승인 = 그 금액만큼 새 코인 발행. 실제 스테이블코인이라면 은행 입금을 확인한 뒤에만 승인해야 합니다. 그 확인은 블록체인 밖의 일이라 코드가 강제하지 못합니다.</p>
        </div>

        <div class="grid grid-2">
          <div class="card"><h2>발행 · 공시 ${tag(ROLES.MINTER)}</h2>
            <div class="field"><label>직접 발행 (요청 없이)</label><div class="row"><input id="mTo" placeholder="닉네임/주소" style="flex:1"><input id="mAmt" type="number" min="1" placeholder="원" style="width:110px"><button class="btn small" id="mint">발행</button></div></div>
            <div class="field"><label>준비금 공시 — 실제로는 은행 잔고 증명이 필요합니다</label><div class="row"><input id="aAmt" type="number" min="0" placeholder="준비자산(원)" style="width:140px"><input id="aEv" placeholder="근거 (예: 10월 감사보고서)" style="flex:1"><button class="btn small" id="attest">공시</button></div></div>
          </div>
          <div class="card"><h2>준법 조치 ${tag(ROLES.COMPLIANCE)} ${tag(ROLES.PAUSER)}</h2>
            <div class="field"><label>대상 계좌와 사유</label><div class="row"><input id="cTo" placeholder="닉네임/주소" style="flex:1"><input id="cWhy" placeholder="사유 (기록에 남음)" style="flex:1"></div></div>
            <div class="row"><button class="btn small btn-danger" id="freeze">동결</button><button class="btn small" id="unfreeze">동결 해제</button><button class="btn small btn-danger" id="wipe">동결자산 강제소각</button>
              <span class="spacer"></span>${paused ? html`<button class="btn small" id="unpause">전체 정지 해제</button>` : html`<button class="btn small btn-danger" id="pause">전체 거래 정지</button>`}</div>
          </div>
        </div>

        <div class="grid grid-2">
          <div class="card"><h2>수수료용 ${chain.cfg.network.currency.symbol} 나눠주기</h2>
            <p class="small muted">새 참여자는 가스비가 없으면 아무것도 못 합니다. 한 줄에 하나씩 닉네임이나 주소. (이건 원화코인이 아니라 이더리움 자체 코인입니다)</p>
            <textarea id="gasTo" rows="3" placeholder="철수&#10;0xAbc..."></textarea>
            <div class="row" style="margin-top:6px"><input id="gasAmt" value="0.01" style="width:90px"> ${chain.cfg.network.currency.symbol}씩 <button class="btn small btn-primary" id="gas">보내기</button></div>
            <div id="gasOut" class="small"></div>
          </div>
          <div class="card"><h2>권한 관리 ${tag('소유자')}</h2>
            <div class="row"><input id="rTo" placeholder="닉네임/주소" style="flex:1"><select id="rRole">${Object.entries(ROLES).map(([k, v]) => html`<option value="${k}">${v}</option>`)}</select></div>
            <div class="row" style="margin-top:6px"><button class="btn small" id="grant">부여</button><button class="btn small" id="revoke">회수</button></div>
            <p class="small muted">한 사람이 모든 권한을 쥐면 그 MetaMask 하나만 털려도 무제한 발행이 가능합니다. 권한을 나눠 보세요.</p>
          </div>
        </div>

        <div class="grid grid-2">
          <div class="card"><h2>보유 현황</h2><div class="table-wrap" style="max-height:360px;overflow:auto"><table><thead><tr><th>회원</th><th class="num">잔액</th><th class="num">비중</th><th></th></tr></thead><tbody>
            ${holders.map(([a, v]) => html`<tr><td>${addrLink(a)}</td><td class="num">${won(v)}</td><td class="num">${supply ? (Number((v * 1000n) / supply) / 10).toFixed(1) : 0}%</td><td>${frozen.has(a) ? tag('동결', 'bad') : ''}</td></tr>`)}
          </tbody></table></div><p class="small muted">Transfer 이벤트를 처음부터 다시 계산한 결과입니다. 합계 ${won(holders.reduce((s, [, v]) => s + v, 0n) + escrow)} = 총 발행량 ${won(supply)} ${holders.reduce((s, [, v]) => s + v, 0n) + escrow === supply ? '✓' : '✗'}</p></div>
          <div class="card"><h2>감사 로그</h2><div class="table-wrap" style="max-height:360px;overflow:auto"><table><tbody>
            ${(await Promise.all(all.slice().reverse().map(async ({ ev, log }) => { const d = describe(ev); return d ? html`<tr><td class="small">${timeAgo(await blockTime(log.blockNumber))}</td><td>${d}</td><td>${txLink(log.transactionHash)}</td></tr>` : ''; })))}
          </tbody></table></div><p class="small muted">발행자의 모든 조치가 이벤트로 남아 누구나 감사할 수 있습니다. ${scan('address', chain.cfg.contracts.WonCoin, '이더스캔 이벤트 탭')}에서도 같은 기록을 볼 수 있습니다.</p></div>
        </div>
        ${explain('감독 관점 체크포인트', html`<ul>
          <li><b>발행 통제</b>: 충전 승인은 은행 입금 확인을 전제로 하지만, 코드는 그걸 확인할 방법이 없습니다. 발행자 내부통제·외부감사가 실제 안전장치입니다.</li>
          <li><b>준비금 공시는 ‘주장’</b>입니다. 비율이 100% 여도 실제 자산이 있다는 보장은 없습니다.</li>
          <li><b>동결·강제소각</b>은 범죄 대응 수단이지만 남용하면 재산권 침해입니다. 사유가 공개 기록으로 남는다는 점이 기존 금융과 다릅니다.</li>
          <li><b>공개성</b>: 회원들의 잔액·거래가 전 세계에 공개됩니다(${chain.cfg.network.name} 은 공개 블록체인). 닉네임으로 가명 처리될 뿐입니다.</li>
        </ul>`, { kind: 'sup' })}
      `);

      const target = (id) => resolveRecipient($(id, view).value);
      const amt = (id) => { const v = $(id, view).value.trim(); if (!/^\d+$/.test(v)) throw new Error('금액은 0 이상 정수'); return BigInt(v); };
      const act = (id, label, fn) => $(id, view)?.addEventListener('click', (ev) => busy(ev.target, async () => { await track(fn(await writable(coin)), label); await draw(); }));
      for (const row of $$('[data-req]', view)) {
        const id = Number(row.dataset.req);
        row.querySelector('[data-ok]').addEventListener('click', (ev) => busy(ev.target, async () => { await track((await writable(coin)).approveRequest(id, '확인 완료'), `요청 #${id} 승인`); await draw(); }));
        row.querySelector('[data-no]').addEventListener('click', (ev) => busy(ev.target, async () => { await track((await writable(coin)).rejectRequest(id, '반려'), `요청 #${id} 거절`); await draw(); }));
      }
      act('#mint', '직접 발행', (c) => c.mint(target('#mTo'), amt('#mAmt'), '발행자 직접 발행'));
      act('#attest', '준비금 공시', (c) => c.attestReserve(amt('#aAmt'), $('#aEv', view).value.trim()));
      act('#freeze', '동결', (c) => c.freeze(target('#cTo'), $('#cWhy', view).value.trim()));
      act('#unfreeze', '동결 해제', (c) => c.unfreeze(target('#cTo'), $('#cWhy', view).value.trim()));
      act('#wipe', '강제 소각', (c) => c.wipeFrozenFunds(target('#cTo'), $('#cWhy', view).value.trim()));
      act('#pause', '전체 정지', (c) => c.pause($('#cWhy', view).value.trim() || '긴급 정지'));
      act('#unpause', '정지 해제', (c) => c.unpause($('#cWhy', view).value.trim() || '정상화'));
      act('#grant', '권한 부여', (c) => c.setRole(E().id($('#rRole', view).value), target('#rTo'), true));
      act('#revoke', '권한 회수', (c) => c.setRole(E().id($('#rRole', view).value), target('#rTo'), false));
      $('#gas', view).addEventListener('click', (ev) => busy(ev.target, async () => {
        const signer = requireWallet();
        const value = E().parseEther($('#gasAmt', view).value || '0');
        for (const line of $('#gasTo', view).value.split('\n').map((s) => s.trim()).filter(Boolean)) {
          const to = resolveRecipient(line);
          const tx = await signer.sendTransaction({ to, value });
          $('#gasOut', view).insertAdjacentHTML('beforeend', `<div>→ ${line} · <a href="#/tx/${tx.hash}">${tx.hash.slice(0, 12)}…</a></div>`);
          await waitReceipt(tx.hash);
        }
        toast('나눠주기 완료', 'ok');
      }));
    };
    await draw();
    app.onWallet(() => draw());
  },
};
