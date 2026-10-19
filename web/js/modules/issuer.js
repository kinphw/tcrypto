import { chain, wallet, rpc, getContract, getEvents, writable, track, artifact, requireWallet, waitReceipt, saveLocalDeployment, blockTime } from '../core/chain.js';
import { html, render, $, fmtNum, timeAgo, short, txLink, addrLink, explain, tag, kv, stat, busy, toast, won, scan, copyBtn } from '../core/ui.js';
import { resolveRecipient } from './send.js';
import { createAddressSteps } from '../core/ledger.js';
import { readInbox, requestStatus } from '../core/inbox.js';

const E = () => globalThis.ethers;
const TOKEN = { name: '서길원', symbol: 'sgw', currency: 'KRW', decimals: 0 };
const INITIAL_ALLOWANCE = 100_000_000n;

function describe(ev) {
  const a = ev.args;
  switch (ev.name) {
    case 'Mint': return html`${tag('발행', 'ok')} ${addrLink(a.minter)} 가 ${addrLink(a.to)} 에게 <b>${won(a.amount)}</b> ${a.memo ? `— “${a.memo}”` : ''}`;
    case 'Burn': return html`${tag('소각', 'warn')} ${addrLink(a.burner)} 가 <b>${won(a.amount)}</b> 소각 ${a.memo ? `— “${a.memo}”` : ''}`;
    case 'MinterConfigured': return html`${tag('발행 한도', 'info')} ${addrLink(a.minter)} 한도 ${won(a.minterAllowedAmount)} 로 설정`;
    case 'MinterRemoved': return html`${tag('발행 담당 해제', 'warn')} ${addrLink(a.oldMinter)}`;
    case 'Blacklisted': return html`${tag('블랙리스트', 'bad')} ${addrLink(a.account)} — “${a.reason}”`;
    case 'UnBlacklisted': return html`${tag('블랙리스트 해제', 'ok')} ${addrLink(a.account)} — “${a.reason}”`;
    case 'BlackFundsDestroyed': return html`${tag('자금 소각', 'bad')} ${addrLink(a.account)} 의 <b>${won(a.amount)}</b> — “${a.reason}”`;
    case 'Pause': return html`${tag('전체 정지', 'bad')} — “${a.reason}”`;
    case 'Unpause': return html`${tag('정지 해제', 'ok')} — “${a.reason}”`;
    case 'ReserveAttested': return html`${tag('준비금 공시', 'info')} ${won(a.reserve)} / 당시 발행 ${won(a.supplyAtTime)} — ${a.evidence}`;
    case 'OwnershipTransferred': return html`${tag('소유자', 'info')} ${addrLink(a.previousOwner)} → ${addrLink(a.newOwner)}`;
    case 'MasterMinterChanged': return html`${tag('발행 총괄 교체', 'info')} → ${addrLink(a.newMasterMinter)}`;
    case 'PauserChanged': return html`${tag('정지 담당 교체', 'info')} → ${addrLink(a.newPauser)}`;
    case 'BlacklisterChanged': return html`${tag('블랙리스트 담당 교체', 'info')} → ${addrLink(a.newBlacklister)}`;
    case 'Upgraded': return html`${tag('업그레이드', 'bad')} 구현이 ${addrLink(a.implementation)} 로 바뀜`;
    case 'AdminChanged': return html`${tag('프록시 관리자', 'info')} ${addrLink(a.previousAdmin)} → ${addrLink(a.newAdmin)}`;
    case 'Clawback': return html`${tag('강제 회수(V2)', 'bad')} ${addrLink(a.from)} 에서 <b>${won(a.amount)}</b> — “${a.reason}”`;
    case 'AuthorizationUsed': return html`${tag('서명 사용')} ${addrLink(a.authorizer)} 의 서명 하나가 쓰임`;
    default: return null;
  }
}

// ───────── 처음 설정: MetaMask 로 6개 배포 + 발행 담당 지정 ─────────
const SETUP = [
  { name: 'Forwarder', ko: '대납 중계', desc: '서명만으로 이름표·상점·코인 만들기를 하게 해 주는 중계기 (ERC-2771)' },
  { name: 'SeogilwonV1', ko: '서길원 구현 V1', desc: '서길원의 규칙(코드). 직접 쓰지 않고 프록시가 빌려 씀' },
  { name: 'SgwProxy', key: 'Seogilwon', ko: '서길원 (프록시)', desc: '모두가 쓰는 서길원의 고정 주소. 잔액이 저장되는 곳' },
  { name: 'Members', ko: '명부', desc: '이름표 (주소 ↔ 이름, 선택)' },
  { name: 'Market', ko: '상점가', desc: '상점·상품·구매 (서길원 주소가 필요)' },
  { name: 'CoinFactory', ko: '코인공장', desc: '누구나 내 코인 만들기' },
];

async function renderSetup(view) {
  const me = wallet.address;
  const nonce0 = Number(await rpc('eth_getTransactionCount', [me, 'latest']));
  const predicted = SETUP.map((s, i) => ({ ...s, nonce: nonce0 + i, ...createAddressSteps(me, nonce0 + i) }));
  const ex = predicted[0];
  render(view, html`
    <div class="page-head"><div><h1>처음 설정 (발행자 전용)</h1><div class="sub">${chain.cfg.network.name} 장부에 거래소 프로그램 6개를 올리고, 자신을 발행 담당으로 지정합니다</div></div></div>
    <div class="card">
      <p>지금 연결된 주소 ${addrLink(me)} 가 서길원의 <b>소유자·발행 총괄·정지 담당·블랙리스트 담당·프록시 관리자</b>가 됩니다 (나중에 각각 다른 사람에게 넘길 수 있음).</p>
      <h3>배포하면 생길 주소 — 미리 계산한 예측</h3>
      <div class="table-wrap"><table><thead><tr><th>순서</th><th>프로그램</th><th class="num">nonce</th><th>예측 주소</th><th>실제</th></tr></thead><tbody>
        ${predicted.map((p, i) => html`<tr id="row-${p.name}"><td>${i + 1}</td><td><b>${p.ko}</b> <span class="muted small">${p.name}</span><br><span class="small muted">${p.desc}</span></td>
          <td class="num">${p.nonce}</td><td class="hash small">${p.address}</td><td class="st small muted">배포 전</td></tr>`)}
        <tr id="row-minter"><td>7</td><td><b>발행 담당 지정</b><br><span class="small muted">발행 총괄(나)이 나에게 발행 한도 ${won(INITIAL_ALLOWANCE)} 를 부여 (배포가 아니라 일반 거래)</span></td><td class="num">${nonce0 + 6}</td><td></td><td class="st small muted">대기</td></tr>
      </tbody></table></div>
      ${explain('주소는 어떻게 미리 알 수 있나', html`
        <p>프로그램 주소는 <b>배포한 사람의 주소와 그 사람의 nonce</b>로 계산됩니다. 이 지갑의 nonce 는 지금 <b>${nonce0}</b> 이라 다음 배포 6개의 번호는 ${nonce0} ~ ${nonce0 + 5} 입니다.</p>
        <pre class="code">① RLP [ ${me}, ${ex.nonce} ] = ${ex.rlp}
② keccak256  = ${ex.hash}
③ 끝 20바이트 → ${ex.address}</pre>
        <p class="small muted">배포 전에 이 지갑으로 다른 거래를 하면 nonce 가 밀려 주소도 바뀝니다.</p>`, { open: true })}
      <p class="small muted">MetaMask 확인 창이 7번 뜹니다(배포 6 + 발행 담당 지정 1). 하나 승인할 때마다 블록에 담길 때까지 10~20초 기다리고, 그동안 이 탭을 닫지 마세요.</p>
      <button class="btn btn-primary" id="deploy">MetaMask 로 배포 시작</button>
      <div id="out" style="margin-top:12px"></div>
    </div>`);
  const setRow = (name, txt) => { const td = $(`#row-${name} .st`, view); if (td) { td.className = 'st small'; td.innerHTML = String(txt); } };
  $('#deploy', view).addEventListener('click', (ev) => busy(ev.target, async () => {
    const signer = requireWallet();
    if (Number(await rpc('eth_getTransactionCount', [wallet.address, 'latest'])) !== nonce0 || wallet.address !== me) throw new Error('예측 뒤에 지갑 상태가 바뀌었습니다. 새로고침하세요.');
    const deployBlock = Number(await rpc('eth_blockNumber'));
    const out = {};
    let cur = predicted[0].name;
    try {
    for (const p of predicted) {
      cur = p.name;
      const a = await artifact(p.name);
      let args = [];
      if (p.name === 'SgwProxy') args = [out.SeogilwonV1, me, new (E().Interface)((await artifact('SeogilwonV1')).abi).encodeFunctionData('initialize', [TOKEN.name, TOKEN.symbol, TOKEN.currency, TOKEN.decimals, me])];
      if (['Members', 'CoinFactory'].includes(p.name)) args = [out.Forwarder];
      if (p.name === 'Market') args = [out.Seogilwon, out.Forwarder];
      setRow(p.name, 'MetaMask 에서 확인을 눌러 주세요…');
      const c = await new (E().ContractFactory)(a.abi, a.bytecode, signer).deploy(...args);
      const h = c.deploymentTransaction().hash;
      setRow(p.name, html`블록에 담기는 중… <a href="#/tx/${h}" target="_blank">${short(h, 6, 4)}</a>`);
      const r = await waitReceipt(h);
      if (r.status !== 1) { setRow(p.name, tag('실패', 'bad')); throw new Error(`${p.ko} 배포 실패`); }
      const addr = E().getAddress(r.contractAddress);
      out[p.key || p.name] = addr;
      setRow(p.name, html`<span class="hash">${addr}</span><br>${addr === p.address ? tag('✓ 예측과 같음', 'ok') : tag('✗ 예측과 다름', 'bad')}`);
    }
    cur = 'minter';
    setRow('minter', 'MetaMask 에서 확인을 눌러 주세요…');
    const tok = new (E().Contract)(out.Seogilwon, (await artifact('SeogilwonV1')).abi, signer);
    const rm = await track(tok.configureMinter(me, INITIAL_ALLOWANCE), '발행 담당 지정');
    setRow('minter', rm.status === 1 ? tag('완료', 'ok') : tag('실패', 'bad'));
    } catch (e) {
      // 거절·오류 시 멈춘 칸에 표시. 이미 올라간 프로그램은 그대로 남으므로 다시 하려면 새로고침(새 nonce 로 다시 예측)
      setRow(cur, html`${tag('중단', 'bad')}<br><span class="small">${e.shortMessage || e.message}</span><br><span class="small muted">새로고침하면 처음부터 다시 예측·배포합니다</span>`);
      throw e;
    }
    saveLocalDeployment({ chainId: chain.cfg.network.chainId, issuer: me, contracts: out, deployBlock });
    const json = JSON.stringify({ issuer: me, contracts: out, deployBlock }, null, 2);
    render($('#out', view), html`<div class="verify ok"><div class="vtitle">${tag('완료', 'ok')} 거래소가 열렸습니다</div>
      <p class="small">이 브라우저에서는 바로 쓸 수 있습니다. <b>다른 사람들도 쓰려면</b> Claude 에게 “배포 끝났어”라고 말해 주세요. 주소를 사이트 설정에 반영합니다.</p>
      <details><summary class="small">설정 정보 (참고용)</summary><pre class="code">${json}</pre>${copyBtn(json)}</details></div>
      <p><button class="btn btn-primary" onclick="location.reload()">거래소 열기</button></p>`);
  }));
}

// ───────── 발행자 · 감독 콘솔 ─────────
export default {
  title: '발행자 · 감독',
  async render(view, params, app) {
    if (!chain.ready) {
      if (!wallet.address) return render(view, html`<div class="card"><h2>처음 설정</h2><p>거래소 컨트랙트가 아직 없습니다. 발행자가 될 사람이 오른쪽 위 <b>MetaMask 연결</b> 후 이 화면에서 배포하세요.</p></div>`);
      return renderSetup(view);
    }
    const token = await getContract('Seogilwon');
    const market = await getContract('Market');
    const members = await getContract('Members');

    const draw = async () => {
      const me = wallet.address;
      const [supply, paused, owner, masterMinter, pauser, blacklister, admin, impl, ver, nAtt, nMembers, nShops, nOrders] = await Promise.all([
        token.totalSupply(), token.paused(), token.owner(), token.masterMinter(), token.pauser(), token.blacklister(), token.proxyAdmin(), token.proxyImplementation(), token.implementationVersion(),
        token.attestationCount(), members.count(), market.shopCount(), market.orderCount(),
      ]);
      const is = (a) => !!me && a.toLowerCase() === me.toLowerCase();
      const [myMinter, myAllowance] = me ? await Promise.all([token.isMinter(me), token.minterAllowance(me)]) : [false, 0n];
      const all = await getEvents(token);
      const purchases = await getEvents(market, 'Purchased');
      const volume = purchases.reduce((s, { ev }) => s + ev.args.total, 0n);
      const last = nAtt > 0n ? await token.attestations(nAtt - 1n) : null;
      const cover = last && supply > 0n ? Number((last.reserve * 10000n) / supply) / 100 : null;

      // 이벤트 재생: 잔액, 블랙리스트, 발행 담당, 상환 접수
      const bal = new Map(); const black = new Set(); const minterSet = new Set(); const redemptions = [];
      for (const { ev, log } of all) {
        const a = ev.args;
        if (ev.name === 'Transfer') {
          if (a.from !== E().ZeroAddress) bal.set(a.from, (bal.get(a.from) || 0n) - a.value);
          if (a.to !== E().ZeroAddress) bal.set(a.to, (bal.get(a.to) || 0n) + a.value);
          if (a.to.toLowerCase() === chain.cfg.issuer.toLowerCase() && a.from !== E().ZeroAddress) redemptions.push({ ev, log });
        }
        if (ev.name === 'Blacklisted') black.add(a.account);
        if (ev.name === 'UnBlacklisted') black.delete(a.account);
        if (ev.name === 'MinterConfigured') minterSet.add(a.minter);
      }
      const minters = (await Promise.all([...minterSet].map(async (m) => ({ m, on: await token.isMinter(m), allow: await token.minterAllowance(m) })))).filter((x) => x.on);
      const holders = [...bal.entries()].filter(([, v]) => v > 0n).sort((x, y) => (y[1] > x[1] ? 1 : -1));
      const sumBal = holders.reduce((s, [, v]) => s + v, 0n);
      const myRoles = [[owner, '소유자'], [masterMinter, '발행 총괄'], [pauser, '정지 담당'], [blacklister, '블랙리스트 담당'], [admin, '프록시 관리자']].filter(([a]) => is(a));

      render(view, html`
        <div class="page-head"><div><h1>발행자 · 감독</h1><div class="sub">서길원 ${addrLink(chain.cfg.contracts.Seogilwon)} ${scan('token', chain.cfg.contracts.Seogilwon)} · 구현 V${ver}</div></div></div>
        ${me ? html`<p class="small">내 역할: ${myRoles.map(([, l]) => tag(l, 'info'))} ${myMinter ? tag(`발행 담당 (남은 한도 ${won(myAllowance)})`, 'info') : ''}
          ${!myRoles.length && !myMinter ? html`<span class="muted">없음 — 볼 수는 있지만 조치는 컨트랙트가 거절합니다</span>` : ''}</p>` : ''}

        <div class="card"><div class="card-head"><h2>받은 요청함</h2><a class="btn btn-primary small" href="#/inbox">요청함 열기 →</a></div>
          <div id="inboxSum" class="small muted">우편함 확인 중…</div></div>

        <div class="stats">
          ${stat('총 발행량', won(supply), paused ? '전체 거래 정지 중' : '정상 유통')}
          ${stat('최근 준비금 비율', cover == null ? '공시 없음' : cover.toFixed(1) + '%', last ? `${won(last.reserve)} 공시` : '')}
          ${stat('보유자', fmtNum(holders.length) + '명', `이름표 ${fmtNum(nMembers)}개`)}
          ${stat('상점 · 주문', `${fmtNum(nShops)} · ${fmtNum(nOrders)}`, `거래액 ${won(volume)}`)}
        </div>

        <div class="card"><div class="card-head"><h2>역할 구조</h2><span class="small muted">USDC 와 같은 방식 — 권한을 쪼개 한 사람이 모든 걸 하지 못하게</span></div>
          ${kv([
            ['소유자 (owner)', addrLink(owner, { full: true }), '역할 담당자 임명·교체'],
            ['발행 총괄 (masterMinter)', addrLink(masterMinter, { full: true }), '발행 담당자 지정과 각자의 발행 한도 결정, 준비금 공시'],
            ['발행 담당 (minter)', minters.length ? html`${minters.map((x) => html`<div>${addrLink(x.m)} — 남은 한도 ${won(x.allow)}</div>`)}` : '없음', '한도 안에서만 발행, 상환 받은 코인 소각'],
            ['정지 담당 (pauser)', addrLink(pauser, { full: true }), '전체 거래 일시정지'],
            ['블랙리스트 담당', addrLink(blacklister, { full: true }), '계좌 차단, 차단 계좌 자금 소각'],
            ['프록시 관리자 (admin)', addrLink(admin, { full: true }), html`서길원의 <b>규칙 자체를 교체</b>할 수 있는 권한 — 가장 강력함`],
            ['현재 구현', html`${addrLink(impl, { full: true })} ${tag('V' + ver, ver === '2' ? 'warn' : 'info')}`, '프록시가 지금 빌려 쓰는 코드'],
          ])}
        </div>

        <div class="grid grid-2">
          <div class="card"><h2>입금 신청 → 발행</h2>
            <p class="small">참여자의 입금 신청는 <a href="#/inbox">요청함</a>에 자동으로 들어옵니다. 링크로 받았다면 아래에 붙여넣어 여세요.</p>
            <div class="row"><input id="lnk" placeholder="https://… #/relay/…" style="flex:1;min-width:160px"><button class="btn small" id="openLnk">열기</button></div>
            <div class="field" style="margin-top:12px"><label>직접 발행 (신청 링크 없이)</label>
              <div class="row"><input id="mTo" placeholder="닉네임/주소" style="flex:1;min-width:120px"><input id="mAmt" type="number" min="1" placeholder="sgw" style="width:110px"><input id="mMemo" placeholder="메모" style="width:120px"><button class="btn small btn-primary" id="mint" ${myMinter ? '' : 'disabled'}>발행</button></div>
              <span class="small muted">발행 담당 한도 안에서만 됩니다. ${myMinter ? `남은 한도 ${won(myAllowance)}` : '지금 지갑은 발행 담당이 아닙니다.'}</span></div>
          </div>
          <div class="card"><h2>환매 처리</h2>
            <p class="small muted">참여자가 발행사 주소로 보낸 서길원 = 환매 신청. 원화를 돌려준 뒤(블록체인 밖) 그만큼 소각합니다.</p>
            ${redemptions.length ? html`<div class="table-wrap" style="max-height:180px;overflow:auto"><table><tbody>${redemptions.slice().reverse().slice(0, 10).map(({ ev, log }) => html`<tr><td>${addrLink(ev.args.from)}</td><td class="num">${won(ev.args.value)}</td><td>${txLink(log.transactionHash)}</td></tr>`)}</tbody></table></div>` : html`<div class="empty small">접수된 상환 없음</div>`}
            <div class="row" style="margin-top:8px"><input id="bAmt" type="number" min="1" placeholder="소각할 sgw" style="width:130px"><input id="bMemo" placeholder="메모 (예: 앨리스 상환)" style="flex:1;min-width:120px"><button class="btn small" id="burn" ${myMinter ? '' : 'disabled'}>소각</button></div>
          </div>
        </div>

        <div class="grid grid-2">
          <div class="card"><h2>발행 담당자 · 한도 ${tag('발행 총괄')}</h2>
            <div class="row"><input id="kTo" placeholder="닉네임/주소" style="flex:1;min-width:120px"><input id="kAmt" type="number" min="0" placeholder="한도 sgw" style="width:120px"></div>
            <div class="row" style="margin-top:6px"><button class="btn small" id="cfgMinter">지정·한도 설정</button><button class="btn small btn-danger" id="rmMinter">해제</button></div>
            <p class="small muted">실제 USDC 도 발행 담당자마다 한도를 두어, 한 담당자의 키가 털려도 피해가 한도 안에 머물게 합니다.</p>
          </div>
          <div class="card"><h2>블랙리스트 · 정지</h2>
            <div class="row"><input id="xTo" placeholder="닉네임/주소" style="flex:1;min-width:120px"><input id="xWhy" placeholder="사유 (공개 기록)" style="flex:1;min-width:120px"></div>
            <div class="row" style="margin-top:6px"><button class="btn small btn-danger" id="bl">블랙리스트</button><button class="btn small" id="ubl">해제</button><button class="btn small btn-danger" id="destroy">차단 자금 소각</button>
              <span class="spacer"></span>${paused ? html`<button class="btn small" id="unpause">정지 해제</button>` : html`<button class="btn small btn-danger" id="pause">전체 거래 정지</button>`}</div>
            ${black.size ? html`<p class="small" style="margin-top:8px">차단 중: ${[...black].map((a) => html`${addrLink(a)} `)}</p>` : ''}
          </div>
        </div>

        <div class="grid grid-2">
          <div class="card"><h2>준비금 공시 ${tag('발행 총괄')}</h2>
            <div class="row"><input id="aAmt" type="number" min="0" placeholder="준비자산 (sgw)" style="width:140px"><input id="aEv" placeholder="근거 (예: 10월 감사보고서)" style="flex:1;min-width:120px"><button class="btn small" id="attest">공시</button></div>
            <p class="small muted">실제로는 회계법인이 매달 보고서로 냅니다. 블록체인 공시는 ‘주장’일 뿐이라 실제 잔고를 보장하지 않습니다.</p>
          </div>
          <div class="card"><h2>업그레이드 ${tag('프록시 관리자')}</h2>
            <p class="small">지금 구현: <b>V${ver}</b> ${addrLink(impl)}. ${ver === '1' ? html`V2 로 바꾸면 같은 주소·같은 잔액 위에 <b>블랙리스트 없이도 소유자가 아무 계좌에서나 코인을 회수하는 권한(clawback)</b>이 생깁니다.` : html`V2 가 적용돼 <b>강제 회수(clawback)</b> 권한이 생겼습니다.`}</p>
            ${ver === '1' ? html`<button class="btn small btn-danger" id="upgrade" ${is(admin) ? '' : 'disabled'}>V2 배포 후 업그레이드</button>`
              : html`<div class="row"><input id="cbFrom" placeholder="회수할 계좌" style="flex:1;min-width:120px"><input id="cbAmt" type="number" min="1" placeholder="sgw" style="width:100px"><input id="cbWhy" placeholder="사유" style="width:110px"><button class="btn small btn-danger" id="clawback">강제 회수</button></div>`}
            <p class="small muted">감독 관점: 이용자는 아무것도 바꾸지 않았는데 발행사가 규칙을 바꿀 수 있습니다. 업그레이드 가능 토큰의 핵심 위험이며, 기록은 감사 로그와 이더스캔에 남습니다.</p>
          </div>
        </div>

        <div class="grid grid-2">
          <div class="card"><h2>역할 넘기기 ${tag('소유자')}</h2>
            <div class="row"><input id="rTo" placeholder="닉네임/주소" style="flex:1;min-width:120px"><select id="rRole">
              <option value="updateMasterMinter">발행 총괄</option><option value="updatePauser">정지 담당</option><option value="updateBlacklister">블랙리스트 담당</option>
              <option value="transferOwnership">소유자</option><option value="changeProxyAdmin">프록시 관리자</option></select><button class="btn small" id="role">넘기기</button></div>
            <p class="small muted">한 사람이 모든 역할을 쥐면 그 MetaMask 하나가 털릴 때 무제한 발행·회수가 가능합니다. 역할을 나눠 보세요.</p>
          </div>
          <div class="card"><h2>수수료용 ${chain.cfg.network.currency.symbol} 나눠주기</h2>
            <p class="small muted">대납 방식이면 참여자에게 ETH 가 필요 없지만, 직접 거래해 보고 싶은 참여자에게 조금 보내 줄 수 있습니다.</p>
            <textarea id="gasTo" rows="2" placeholder="닉네임 또는 주소, 한 줄에 하나"></textarea>
            <div class="row" style="margin-top:6px"><input id="gasAmt" value="0.005" style="width:90px"> ${chain.cfg.network.currency.symbol}씩 <button class="btn small" id="gas">보내기</button></div>
          </div>
        </div>

        <div class="grid grid-2">
          <div class="card"><h2>보유 현황</h2><div class="table-wrap" style="max-height:360px;overflow:auto"><table><thead><tr><th>계좌</th><th class="num">잔액</th><th class="num">비중</th><th></th></tr></thead><tbody>
            ${holders.map(([a, v]) => html`<tr><td>${addrLink(a)}</td><td class="num">${won(v)}</td><td class="num">${supply ? (Number((v * 1000n) / supply) / 10).toFixed(1) : 0}%</td><td>${black.has(a) ? tag('차단', 'bad') : ''}</td></tr>`)}
          </tbody></table></div><p class="small muted">Transfer 기록을 처음부터 다시 더한 결과: 합계 ${won(sumBal)} ${sumBal === supply ? '= 총 발행량 ✓' : '≠ 총 발행량 ✗'}</p></div>
          <div class="card"><h2>감사 로그</h2><div class="table-wrap" style="max-height:360px;overflow:auto"><table><tbody>
            ${(await Promise.all(all.slice().reverse().map(async ({ ev, log }) => { const d = describe(ev); return d ? html`<tr><td class="small">${timeAgo(await blockTime(log.blockNumber))}</td><td>${d}</td><td>${txLink(log.transactionHash)}</td></tr>` : ''; })))}
          </tbody></table></div></div>
        </div>
      `);

      const who = (id) => resolveRecipient($(id, view).value);
      const num = (id) => { const v = $(id, view).value.trim(); if (!/^\d+$/.test(v)) throw new Error('수량은 0 이상 정수'); return BigInt(v); };
      const why = (id, d) => $(id, view).value.trim() || d;
      // 발행 담당은 서명할 수 있는 지갑이어야 한다. 컨트랙트(서길원 코인 주소 등)에 한도를 주면 아무도 쓸 수 없는 한도가 된다.
      const minterWho = async (id) => {
        const a = who(id);
        const code = await rpc('eth_getCode', [a, 'latest']);
        if (code && code !== '0x' && !code.startsWith('0xef0100')) { // 0xef0100… = 스마트 계정(EIP-7702)으로 바뀐 개인 지갑
          const name = Object.entries(chain.cfg.contracts).find(([, v]) => v.toLowerCase() === a.toLowerCase())?.[0];
          throw new Error(`${short(a, 6, 4)} 는 ${name ? `${name} 컨트랙트` : '컨트랙트'} 주소입니다. 발행 담당은 MetaMask 같은 지갑 주소여야 합니다.`);
        }
        return a;
      };
      const act = (id, label, fn) => $(id, view)?.addEventListener('click', (ev) => busy(ev.target, async () => { await track(fn(await writable(token)), label); await draw(); }));
      $('#openLnk', view).addEventListener('click', () => { const v = $('#lnk', view).value.trim(); const i = v.indexOf('#/relay/'); if (i < 0) return toast('#/relay/ 가 들어 있는 링크를 붙여넣으세요', 'bad'); location.hash = v.slice(i); });
      act('#mint', '발행', (c) => c.mint(who('#mTo'), num('#mAmt'), why('#mMemo', '발행자 직접 발행')));
      readInbox().then(async ({ items }) => {
        const ctx = {};
        const sts = await Promise.all(items.map((it) => requestStatus(it.obj, it.v, ctx).catch(() => ['bad'])));
        const wait = items.filter((_, i) => sts[i][0] === 'ready' || sts[i][0] === 'wait');
        const el = $('#inboxSum', view);
        if (!el) return;
        const byKind = (k) => wait.filter((it) => it.obj.k === k).length;
        el.innerHTML = wait.length
          ? `<b>처리 대기 ${wait.length}건</b> — 입금 신청 ${byKind('notice')} · 올려 주기 ${byKind('fwd') + byKind('auth') + byKind('buy')} · ETH 요청 ${byKind('gas')}`
          : '처리할 요청이 없습니다';
      }).catch(() => { const el = $('#inboxSum', view); if (el) el.textContent = '우편함에 연결하지 못했습니다 — 링크로 받은 요청은 아래에 붙여넣어 여세요'; });
      act('#burn', '소각', (c) => c.burn(num('#bAmt'), why('#bMemo', '환매 처리')));
      act('#cfgMinter', '발행 한도 설정', async (c) => c.configureMinter(await minterWho('#kTo'), num('#kAmt')));
      act('#rmMinter', '발행 담당 해제', (c) => c.removeMinter(who('#kTo')));
      act('#bl', '블랙리스트', (c) => c.blacklist(who('#xTo'), why('#xWhy', '사유 미기재')));
      act('#ubl', '블랙리스트 해제', (c) => c.unBlacklist(who('#xTo'), why('#xWhy', '사유 미기재')));
      act('#destroy', '차단 자금 소각', (c) => c.destroyBlackFunds(who('#xTo'), why('#xWhy', '사유 미기재')));
      act('#pause', '전체 정지', (c) => c.pause(why('#xWhy', '긴급 정지')));
      act('#unpause', '정지 해제', (c) => c.unpause(why('#xWhy', '정상화')));
      act('#attest', '준비금 공시', (c) => c.attestReserve(num('#aAmt'), why('#aEv', '근거 미기재')));
      act('#clawback', '강제 회수', (c) => c.clawback(who('#cbFrom'), num('#cbAmt'), why('#cbWhy', 'V2 권한 시험')));
      act('#role', '역할 넘기기', (c) => c[$('#rRole', view).value](who('#rTo')));
      $('#upgrade', view)?.addEventListener('click', (ev) => busy(ev.target, async () => {
        const signer = requireWallet();
        const v2 = await artifact('SeogilwonV2');
        toast('1단계: V2 구현 배포 — MetaMask 에서 승인하세요');
        const c = await new (E().ContractFactory)(v2.abi, v2.bytecode, signer).deploy();
        const r = await waitReceipt(c.deploymentTransaction().hash);
        if (r.status !== 1) throw new Error('V2 배포 실패');
        toast('2단계: 프록시가 V2 를 가리키도록 교체 — MetaMask 에서 승인하세요');
        await track((await writable(token)).upgradeTo(r.contractAddress), '업그레이드');
        await draw();
      }));
      $('#gas', view).addEventListener('click', (ev) => busy(ev.target, async () => {
        const signer = requireWallet();
        const value = E().parseEther($('#gasAmt', view).value || '0');
        for (const line of $('#gasTo', view).value.split('\n').map((s) => s.trim()).filter(Boolean)) {
          const tx = await signer.sendTransaction({ to: resolveRecipient(line), value });
          await waitReceipt(tx.hash);
          toast(`${line} 에게 보냄`, 'ok');
        }
      }));
    };
    await draw();
    app.onWallet(() => draw());
  },
};
