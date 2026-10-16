import { chain, rpc } from '../core/chain.js';
import { html, render, $, fmtNum, fmtUnits, fmtTime, short, blockLink, addrLink, explain, kv, verifyBox, tag, copyBtn, scan } from '../core/ui.js';
import { verifyTransaction } from '../core/verify.js';
import { decodeInput, decodeLog, fmtArg } from '../core/abi.js';

const E = () => globalThis.ethers;
const TYPES = { 0: '레거시 (type 0)', 1: '접근목록 (type 1)', 2: 'EIP-1559 (type 2)', 3: '블롭 (type 3)', 4: '계정 위임 (type 4)' };

function argsTable(inputs, args) {
  if (!inputs?.length) return html`<span class="muted">인자 없음</span>`;
  return html`<table class="kv"><tbody>${inputs.map((inp, i) => html`<tr><td><code>${inp.name || '#' + i}</code> <span class="muted small">${inp.type}</span></td>
    <td class="break">${inp.type === 'address' ? addrLink(args[i]) : fmtArg(inp, args[i])}</td></tr>`)}</tbody></table>`;
}

export default {
  title: '거래 해부',
  async render(view, params, app) {
    const hash = params[0];
    const net = chain.cfg.network;
    const sym = net.currency.symbol;
    if (!hash) {
      render(view, html`<div class="card"><h2>거래 해부</h2><p>위 검색창에 거래 해시(0x… 66자)를 넣거나 <a href="#/explore">들여다보기</a>에서 거래를 고르세요.</p></div>`);
      return;
    }
    const draw = async () => {
      const t = await rpc('eth_getTransactionByHash', [hash]);
      if (!t) {
        render(view, html`<div class="card"><h2>거래를 아직 찾을 수 없습니다</h2><p class="hash">${hash}</p><p class="muted">방금 보냈다면 공개 노드에 전달되기까지 몇 초 걸릴 수 있습니다. ${scan('tx', hash)}</p></div>`);
        return false;
      }
      const receipt = t.blockNumber ? await rpc('eth_getTransactionReceipt', [hash]) : null;
      const block = t.blockNumber ? await rpc('eth_getBlockByNumber', [t.blockNumber, false]) : null;
      const v = verifyTransaction(t);
      const dec = await decodeInput(t.to, t.input);
      const n = receipt ? Number(receipt.blockNumber) : null;
      const depth = n != null ? Math.max(0, chain.head - n) : 0;
      const eth = (wei) => html`${E().formatEther(wei)} ${sym} <span class="muted small">(${fmtNum(wei)} wei)</span>`;
      const gasUsed = receipt ? BigInt(receipt.gasUsed) : 0n;
      const baseFee = block?.baseFeePerGas ? BigInt(block.baseFeePerGas) : 0n;
      const eff = receipt ? BigInt(receipt.effectiveGasPrice) : 0n;
      const burned = baseFee * gasUsed, tip = (eff - baseFee) * gasUsed, fee = eff * gasUsed;
      const logs = receipt ? await Promise.all(receipt.logs.map(async (l) => ({ l, d: await decodeLog(l) }))) : [];
      const type = Number(t.type);

      render(view, html`
        <div class="page-head"><div>
          <h1>거래 해부 ${!receipt ? tag('대기 중', 'warn') : receipt.status === '0x1' ? tag('성공', 'ok') : tag('실패 — 컨트랙트가 거절', 'bad')}</h1>
          <div class="sub hash">${hash} ${copyBtn(hash)}</div></div><span class="spacer"></span>
          ${scan('tx', hash, '이더스캔에서 같은 거래 보기 ↗')}</div>

        <div class="card"><h2>거래의 일생</h2>
          <div class="timeline">
            <div class="step done"><b>① 서명</b>보낸 사람의 MetaMask 가 개인키로 서명</div>
            <div class="step ${receipt ? 'done' : 'now'}"><b>② 전파 · 대기</b>이더리움 노드들이 서로 전달하며 대기열에서 기다림</div>
            <div class="step ${receipt ? 'done' : ''}"><b>③ 블록에 담김</b>${n != null ? html`${blockLink(n)} · ${fmtTime(block.timestamp)}` : '검증자가 블록에 담기 전'}</div>
            <div class="step ${receipt && depth >= 64 ? 'done' : receipt ? 'now' : ''}"><b>④ 최종 확정</b>${n != null ? html`이후 ${fmtNum(depth)}블록 쌓임 ${depth >= 64 ? '— 되돌릴 수 없음' : '(약 64블록≈13분 후 최종 확정)'}` : ''}</div>
          </div>
          <p class="small muted">이더리움(지분증명)은 블록에 담긴 뒤 약 2 에포크(64블록, 13분)가 지나야 ‘최종(finalized)’이 됩니다. 그 전에는 이론상 순서가 바뀔 수 있습니다.</p>
        </div>

        <div class="grid grid-2">
          <div class="card"><h2>요약</h2>
            ${kv([
              ['보낸 사람', addrLink(t.from, { full: true, copy: true })],
              ['받는 곳', t.to ? addrLink(t.to, { full: true, copy: true }) : html`${tag('컨트랙트 생성', 'info')} → ${receipt?.contractAddress ? addrLink(receipt.contractAddress, { full: true }) : '…'}`],
              ['함께 보낸 ' + sym, fmtUnits(t.value, 18, 8)],
              ['논스', html`${Number(t.nonce)} <span class="muted small">— 이 주소가 보낸 ${Number(t.nonce) + 1}번째 거래 (재전송 공격 방지용 일련번호)</span>`],
              ['거래 유형', TYPES[type] || type],
              ['가스 한도 / 사용', receipt ? `${fmtNum(BigInt(t.gas))} / ${fmtNum(gasUsed)}` : fmtNum(BigInt(t.gas))],
              ['블록 내 순서', receipt ? `${Number(receipt.transactionIndex)}번째 (블록 전체 ${block.transactions.length}건 중)` : '—'],
            ])}
          </div>
          <div class="card"><h2>수수료는 어디로 갔나</h2>
            ${receipt ? html`${kv([
              ['총 수수료', html`<b>${eth(fee)}</b>`, `사용 가스 ${fmtNum(gasUsed)} × 가스 가격 ${fmtNum(eff)} wei`],
              ['🔥 소각', eth(burned), `기본 수수료 ${fmtNum(baseFee)} wei × 가스 — 영구 삭제`],
              ['💰 검증자 몫', eth(tip), html`이 블록을 만든 검증자 ${addrLink(block.miner)}`],
            ])}<p class="small muted">수수료는 원화코인이 아니라 이더리움 자체 코인(${sym})으로 냅니다. 세폴리아에서는 가치가 없는 시험용입니다.</p>` : html`<span class="muted">블록에 담기면 계산됩니다</span>`}
          </div>
        </div>

        <div class="card"><h2>무엇을 실행했나</h2>
          ${!dec ? html`<p>입력 데이터 없음 — <b>${sym} 단순 이전</b>입니다.</p>`
            : dec.kind === 'deploy' ? html`<p>${tag('컨트랙트 배포', 'info')} <b>${dec.contract || '알 수 없는 컨트랙트'}</b> — 입력 데이터 = 컴파일된 기계어 + 생성자 인자</p>${dec.inputs ? argsTable(dec.inputs, dec.args || []) : ''}`
            : dec.kind === 'call' ? html`<p>${tag(dec.contract)} 컨트랙트의 <b><code>${dec.name}</code></b> 함수 호출 <span class="muted small">— 입력 앞 4바이트 ${dec.selector} = keccak256("${dec.signature}") 의 앞부분</span></p>${argsTable(dec.inputs, dec.args)}`
            : html`<p>이 실험실 컨트랙트가 아닌 곳의 함수 (선택자 ${dec.selector})</p>`}
          <details style="margin-top:8px"><summary class="small muted">입력 데이터 원본 (${fmtNum((t.input.length - 2) / 2)} 바이트)</summary><pre class="code">${t.input.length > 4000 ? t.input.slice(0, 4000) + '…' : t.input}</pre></details>
        </div>

        <div class="card"><div class="card-head"><h2>전자서명 해부</h2><span class="muted small">정말 ‘보낸 사람’이 승인했는가?</span></div>
          ${v.unsupported ? html`<p class="muted">type ${v.type} 거래는 이 화면에서 서명 재계산을 지원하지 않습니다. ${scan('tx', hash)}</p>` : html`
            ${explain('원리', html`<p>거래 안에는 보낸 사람 주소가 들어 있지 않습니다. 노드는 서명(r, s, v)과 서명 대상 해시만으로 공개키를 <b>복원</b>하고, 거기서 주소를 계산합니다.
              개인키 없이는 이 서명을 만들 수 없으므로, 복원된 주소의 주인이 승인했다는 증거가 됩니다.</p>`)}
            ${kv([
              ['서명 대상 해시', html`<span class="hash">${v.signingHash}</span>`, '체인ID·논스·수수료·받는곳·금액·데이터를 RLP 로 묶어 keccak256'],
              ['r', html`<span class="hash">${v.signature.r}</span>`], ['s', html`<span class="hash">${v.signature.s}</span>`],
              ['v / yParity', String(type === 0 ? Number(t.v) : v.signature.yParity)],
            ])}
            ${verifyBox(v.fromOk, '서명자 복원 (이 브라우저에서 계산)', html`서명 → 공개키 복원 → keccak256 → 끝 20바이트 = ${addrLink(v.recoveredFrom, { full: true })}`)}
            ${verifyBox(v.hashOk, '거래 해시 재계산', html`서명 포함 거래 ${fmtNum(v.size)}바이트 → keccak256 = <span class="hash">${v.hash}</span>`)}
            <p class="small muted">체인 ID ${Number(t.chainId)} 가 서명에 들어 있어 이 서명을 이더리움 메인넷 등 다른 체인에서 재사용할 수 없습니다 (EIP-155).</p>`}
        </div>

        <div class="card"><div class="card-head"><h2>발생한 이벤트 (로그)</h2>${scan('tx', hash + '#eventlog', '이더스캔 Logs 탭 ↗')}</div>
          ${!receipt ? html`<span class="muted">대기 중</span>` : logs.length ? html`${logs.map(({ l, d }) => html`<div class="verify">
            <div class="vtitle">${d ? html`${tag(d.contract)} <code>${d.name}</code>` : '해독 불가 로그'} <span class="muted small">${addrLink(l.address)}</span></div>
            ${d ? argsTable(d.inputs, d.args) : ''}</div>`)}` : html`<div class="empty">이벤트 없음</div>`}
          ${explain('이벤트 로그와 장부 변화', html`<p>컨트랙트는 “누가 누구에게 얼마를 옮겼다(Transfer)” 같은 기록을 남깁니다. 이 웹사이트의 잔액·주문·요청 목록은 전부 이 로그를 모아 만든 것입니다.
            로그가 아니라 <b>저장소(잔액표) 자체가 어떻게 바뀌었는지</b>는 ${scan('tx', hash + '#statechange', '이더스캔의 State 탭')}에서 거래 전·후 값을 볼 수 있습니다.</p>`)}
        </div>
        <details class="card"><summary><b>노드가 준 원본 JSON</b></summary><pre class="code">${JSON.stringify({ transaction: { ...t, input: t.input.length > 2000 ? t.input.slice(0, 2000) + '…' : t.input }, receipt }, null, 2)}</pre></details>
      `);
      return !!receipt;
    };
    const done = await draw();
    if (!done) {
      let finished = false;
      app.onBlock(async () => { if (!finished && (await rpc('eth_getTransactionReceipt', [hash]))) { finished = true; await draw(); } });
    }
  },
};
