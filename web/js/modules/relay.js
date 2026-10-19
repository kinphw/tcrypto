import { chain, wallet, getContract, writable, track } from '../core/chain.js';
import { html, render, $, fmtNum, fmtTime, short, addrLink, explain, kv, verifyBox, tag, busy, won, toast } from '../core/ui.js';
import { decodeRelay, verifyRelay, submitRelay, approveNotice, GAS_GIFT } from '../core/relay.js';
import { requestStatus } from '../core/inbox.js';
import { decodeInput, fmtArg } from '../core/abi.js';
import { splitSig } from '../core/sigs.js';

const E = () => globalThis.ethers;
export const KIND = { fwd: '대납 중계 요청 (ERC-2771)', auth: '서명 송금 (EIP-3009)', buy: '서명 결제 (EIP-3009)', notice: '입금 신고서 (블록체인 밖 서명)', gas: '수수료용 ETH 요청 (블록체인 밖 서명)' };

/** 요청 내용을 사람 말로 (요청함 목록과 개별 화면이 같이 씀) */
export async function describeRequest(obj, { short: brief = false } = {}) {
  if (obj.k === 'fwd') {
    const dec = await decodeInput(obj.req.to, obj.req.data);
    if (brief) return html`${addrLink(obj.req.from)} → ${addrLink(obj.req.to)} 의 <code>${dec?.name || '?'}</code>`;
    return html`<p><b>${addrLink(obj.req.from)}</b> 가 ${addrLink(obj.req.to)} 의 <code>${dec?.name || '?'}</code> 함수를 자기 이름으로 실행해 달라고 서명했습니다.</p>
      ${dec?.inputs ? html`<table class="kv"><tbody>${dec.inputs.map((inp, i) => html`<tr><td><code>${inp.name}</code></td><td class="break">${inp.type === 'address' ? addrLink(dec.args[i]) : fmtArg(inp, dec.args[i])}</td></tr>`)}</tbody></table>` : ''}`;
  }
  if (obj.k === 'auth') {
    const a = obj.auth;
    return html`${brief ? '' : '<p>'}<b>${addrLink(a.from)}</b> 가 <b>${addrLink(a.to)}</b> 에게 <b>${won(a.value)}</b> 를 보내는 데 서명했습니다.${brief ? '' : '</p>'}`;
  }
  if (obj.k === 'buy') {
    const a = obj.auth;
    const p = await (await getContract('Market')).getProduct(obj.productId).catch(() => null);
    return html`${brief ? '' : '<p>'}<b>${addrLink(a.from)}</b> 가 상품 <a href="#/shop/p/${obj.productId}">${p ? p.name : '#' + obj.productId}</a> ${obj.quantity}개를 <b>${won(a.value)}</b> 에 사는 데 서명했습니다. ${obj.note ? `요청사항: “${obj.note}”` : ''}${brief ? '' : '</p>'}`;
  }
  if (obj.k === 'notice') {
    const n = obj.notice;
    return html`${brief ? '' : '<p>'}<b>${addrLink(n.account)}</b> 가 <b>${won(n.amount)}</b> 입금을 신고했습니다. 메모: “${n.memo}” · 신고 시각 ${fmtTime(n.issuedAt)}${brief ? '' : '</p>'}
      ${brief ? '' : html`<p class="small muted">실제 스테이블코인이라면 발행사가 은행 계좌에 이 금액이 정말 들어왔는지 확인한 뒤에만 발행합니다. 그 확인은 블록체인 밖의 일이라 코드가 대신하지 못합니다.</p>`}`;
  }
  if (obj.k === 'gas') {
    return html`${brief ? '' : '<p>'}<b>${addrLink(obj.gas.account)}</b> 가 직접 거래해 보려고 수수료용 ETH 를 요청했습니다. (보내면 ${GAS_GIFT} ETH)${brief ? '' : '</p>'}`;
  }
  return '알 수 없는 요청';
}

/** 상태 표시 배지 */
export function statusTag(obj, s) {
  if (s === 'ready') return tag('미처리', 'ok');
  if (s === 'used') return tag(obj.k === 'notice' ? '발행됨' : obj.k === 'gas' ? '처리됨' : '사용됨');
  if (s === 'wait') return tag('순서 대기', 'warn');
  return tag(s === 'expired' ? '만료' : '오류', 'bad');
}

export default {
  title: '대납 요청',
  async render(view, params) {
    let obj;
    try { obj = await decodeRelay(params.join('/')); } catch { return render(view, html`<div class="card"><h2>링크를 읽지 못했습니다</h2><p>링크가 잘렸을 수 있어요. 보낸 사람에게 다시 받아 주세요.</p></div>`); }
    if (obj.chainId !== chain.cfg.network.chainId) return render(view, html`<div class="card"><h2>다른 네트워크용 요청입니다</h2><p>체인 ID ${obj.chainId} 용 서명입니다.</p></div>`);
    const v = verifyRelay(obj);
    const sym = 'sgw';

    // 무엇을 하려는 요청인지
    const what = await describeRequest(obj);
    const st = await requestStatus(obj, v);
    const status = [st[0], st[2] ? html`${st[1]} — <a href="#/tx/${st[2]}">발행 거래</a>` : st[1]];
    const s = splitSig(obj.sig);
    const isMinter = wallet.address ? await (await getContract('Seogilwon')).isMinter(wallet.address) : false;

    render(view, html`
      <div class="page-head"><div><h1>${obj.k === 'notice' ? '입금 신고 확인' : '대납 요청'}</h1><div class="sub">${KIND[obj.k]} · ${obj.label}</div></div></div>
      <div class="card"><h2>요청 내용</h2>${what}
        <p>${statusTag(obj, status[0])} <span class="small muted">${status[1]}</span></p>
        <div class="row" style="margin-top:10px">
          ${obj.k === 'notice'
            ? html`<button class="btn btn-primary" id="mintBtn" ${isMinter && status[0] === 'ready' ? '' : 'disabled'}>입금 확인 → ${won(obj.notice.amount)} 발행</button>${isMinter ? '' : html`<span class="small muted">발행 담당자 지갑으로 연결해야 합니다</span>`}`
            : html`<button class="btn btn-primary" id="relayBtn" ${status[0] === 'ready' && v.ok ? '' : 'disabled'}>${obj.k === 'gas' ? `ETH ${GAS_GIFT} 보내기` : '수수료 내고 대신 올리기'}</button>
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
      const r = await approveNotice(obj);
      render($('#result', view), html`<p style="margin-top:10px">${r.status === 1 ? tag('발행 완료', 'ok') : tag('실패', 'bad')} <a href="#/tx/${r.hash}">거래 해부에서 보기 →</a></p>`);
    }));
  },
};
