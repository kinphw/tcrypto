import { chain, wallet, getContract, getEvents, writable, track } from '../core/chain.js';
import { html, render, $, fmtNum, fmtTime, short, addrLink, explain, kv, verifyBox, tag, busy, won, toast } from '../core/ui.js';
import { decodeRelay, verifyRelay, submitRelay } from '../core/relay.js';
import { decodeInput, fmtArg } from '../core/abi.js';
import { splitSig } from '../core/sigs.js';

const E = () => globalThis.ethers;
const KIND = { fwd: '대납 중계 요청 (ERC-2771)', auth: '서명 송금 (EIP-3009)', buy: '서명 결제 (EIP-3009)', notice: '입금 신고서 (블록체인 밖 서명)' };

export default {
  title: '대납 요청',
  async render(view, params) {
    let obj;
    try { obj = await decodeRelay(params.join('/')); } catch { return render(view, html`<div class="card"><h2>링크를 읽지 못했습니다</h2><p>링크가 잘렸을 수 있어요. 보낸 사람에게 다시 받아 주세요.</p></div>`); }
    if (obj.chainId !== chain.cfg.network.chainId) return render(view, html`<div class="card"><h2>다른 네트워크용 요청입니다</h2><p>체인 ID ${obj.chainId} 용 서명입니다.</p></div>`);
    const v = verifyRelay(obj);
    const sym = 'sgw';

    // 무엇을 하려는 요청인지
    let what = '', status = null;
    if (obj.k === 'fwd') {
      const dec = await decodeInput(obj.req.to, obj.req.data);
      what = html`<p><b>${addrLink(obj.req.from)}</b> 가 ${addrLink(obj.req.to)} 의 <code>${dec?.name || '?'}</code> 함수를 자기 이름으로 실행해 달라고 서명했습니다.</p>
        ${dec?.inputs ? html`<table class="kv"><tbody>${dec.inputs.map((inp, i) => html`<tr><td><code>${inp.name}</code></td><td class="break">${inp.type === 'address' ? addrLink(dec.args[i]) : fmtArg(inp, dec.args[i])}</td></tr>`)}</tbody></table>` : ''}`;
      const f = await getContract('Forwarder');
      const n = await f.nonces(obj.req.from);
      const expired = Number(obj.req.deadline) < Date.now() / 1000;
      status = n > BigInt(obj.req.nonce) ? ['used', '이미 실행됐거나, 이 사람이 이후 다른 요청을 먼저 실행해 무효가 됐습니다'] : expired ? ['expired', '유효기간이 지났습니다'] : ['ready', '실행 가능'];
    } else if (obj.k === 'auth' || obj.k === 'buy') {
      const a = obj.auth;
      if (obj.k === 'auth') what = html`<p><b>${addrLink(a.from)}</b> 가 <b>${addrLink(a.to)}</b> 에게 <b>${won(a.value)}</b> 를 보내는 데 서명했습니다.</p>`;
      else {
        const m = await getContract('Market');
        const p = await m.getProduct(obj.productId).catch(() => null);
        what = html`<p><b>${addrLink(a.from)}</b> 가 상품 <a href="#/shop/p/${obj.productId}">${p ? p.name : '#' + obj.productId}</a> ${obj.quantity}개를 <b>${won(a.value)}</b> 에 사는 데 서명했습니다. ${obj.note ? `요청사항: “${obj.note}”` : ''}</p>`;
      }
      const t = await getContract('Seogilwon');
      const used = await t.authorizationState(a.from, a.nonce);
      const expired = Number(a.validBefore) < Date.now() / 1000;
      status = used ? ['used', '이미 사용된 서명입니다 (한 번만 쓸 수 있음)'] : expired ? ['expired', '유효기간이 지났습니다'] : ['ready', '실행 가능'];
    } else if (obj.k === 'notice') {
      const n = obj.notice;
      what = html`<p><b>${addrLink(n.account)}</b> 가 <b>${won(n.amount)}</b> 입금을 신고했습니다. 메모: “${n.memo}” · 신고 시각 ${fmtTime(n.issuedAt)}</p>
        <p class="small muted">실제 스테이블코인이라면 발행사가 은행 계좌에 이 금액이 정말 들어왔는지 확인한 뒤에만 발행합니다. 그 확인은 블록체인 밖의 일이라 코드가 대신하지 못합니다.</p>`;
      // 같은 신고서로 두 번 발행하지 않도록: 발행 메모에 신고서 지문(서명 대상 해시)을 남기고, 이미 있는지 찾아봄
      const mints = await getEvents(await getContract('Seogilwon'), 'Mint');
      const done = mints.find(({ ev }) => ev.args.memo.includes(v.digest));
      status = done ? ['used', html`이미 이 신고서로 발행했습니다 — <a href="#/tx/${done.log.transactionHash}">발행 거래</a>`] : ['ready', '아직 발행하지 않은 신고서'];
    }
    const s = splitSig(obj.sig);
    const isMinter = wallet.address ? await (await getContract('Seogilwon')).isMinter(wallet.address) : false;

    render(view, html`
      <div class="page-head"><div><h1>${obj.k === 'notice' ? '입금 신고 확인' : '대납 요청'}</h1><div class="sub">${KIND[obj.k]} · ${obj.label}</div></div></div>
      <div class="card"><h2>요청 내용</h2>${what}
        ${status ? html`<p>${status[0] === 'ready' ? tag(obj.k === 'notice' ? '미처리' : '실행 가능', 'ok') : tag(status[0] === 'used' ? (obj.k === 'notice' ? '발행됨' : '사용됨') : '만료', 'bad')} <span class="small muted">${status[1]}</span></p>` : ''}
        <div class="row" style="margin-top:10px">
          ${obj.k === 'notice'
            ? html`<button class="btn btn-primary" id="mintBtn" ${isMinter && status[0] === 'ready' ? '' : 'disabled'}>입금 확인 → ${won(obj.notice.amount)} 발행</button>${isMinter ? '' : html`<span class="small muted">발행 담당자 지갑으로 연결해야 합니다</span>`}`
            : html`<button class="btn btn-primary" id="relayBtn" ${status?.[0] === 'ready' && v.ok ? '' : 'disabled'}>수수료 내고 대신 올리기</button>
               ${wallet.address ? '' : html`<span class="small muted">MetaMask 연결 + 수수료용 ETH 가 필요합니다</span>`}`}
        </div>
        <div id="result"></div>
      </div>
      <div class="card"><div class="card-head"><h2>서명 검증</h2><span class="muted small">이 브라우저에서 직접 계산</span></div>
        ${verifyBox(v.ok, `서명자 복원: ${v.signer}`, html`요청에 적힌 당사자 ${addrLink(v.expected)} 와 ${v.ok ? '같습니다. 내용이 한 글자라도 바뀌었다면 다른 주소가 나왔을 것입니다.' : '다릅니다! 조작된 링크일 수 있습니다.'}`)}
        ${kv([
          ['서명 대상 해시 (EIP-712)', html`<span class="hash">${v.digest}</span>`, 'keccak256(0x1901 ‖ 도메인 지문 ‖ 내용 지문)'],
          ['r', html`<span class="hash">${s.r}</span>`], ['s', html`<span class="hash">${s.s}</span>`], ['v', String(s.v)],
        ])}
        <details style="margin-top:8px"><summary class="small"><b>원본 보기</b> — MetaMask 가 서명한 구조화 데이터 그대로</summary>
          <pre class="code">${JSON.stringify({ domain: v.domain, types: v.types, message: v.message }, (k, x) => (typeof x === 'bigint' ? x.toString() : x), 2)}</pre>
          <pre class="code" style="margin-top:6px">서명값 ${obj.sig}</pre></details>
      </div>
      ${explain('누가 수수료를 내고, 누가 권한을 갖나', html`<p>이 요청을 올리는 사람(대납자)이 ETH 수수료를 냅니다. 하지만 블록체인에 기록되는 행위자는 <b>서명한 사람</b>입니다.
        대납자는 받는 사람·금액을 바꿀 수 없고(서명이 깨짐), 같은 서명을 두 번 쓸 수도 없습니다(서명 번호가 기록됨). 할 수 있는 나쁜 일은 ‘안 올려주기’뿐입니다.</p>
        <p>실제 서비스(지갑 회사, 결제 회사, 발행사)는 이 일을 서버가 자동으로 합니다. 블록체인은 탈중앙이어도, 편의를 위한 이런 중개자는 다시 생겨납니다 — 감독 대상이 되는 지점이기도 합니다.</p>`, { kind: 'sup' })}
    `);

    $('#relayBtn', view)?.addEventListener('click', (ev) => busy(ev.target, async () => {
      const r = await submitRelay(obj);
      render($('#result', view), html`<p style="margin-top:10px">${r.status === 1 ? tag('완료', 'ok') : tag('실패', 'bad')} <a href="#/tx/${r.hash}">거래 해부에서 보기 →</a>
        <span class="small muted">— 보낸 사람(수수료)은 당신, 실제 행위자는 서명한 사람으로 기록됩니다.</span></p>`);
    }));
    $('#mintBtn', view)?.addEventListener('click', (ev) => busy(ev.target, async () => {
      const t = await writable(await getContract('Seogilwon'));
      const r = await track(t.mint(obj.notice.account, BigInt(obj.notice.amount), `입금 신고 ${v.digest} 확인`), '발행');
      render($('#result', view), html`<p style="margin-top:10px">${r.status === 1 ? tag('발행 완료', 'ok') : tag('실패', 'bad')} <a href="#/tx/${r.hash}">거래 해부에서 보기 →</a></p>`);
    }));
  },
};
