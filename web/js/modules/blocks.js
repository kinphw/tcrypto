import { chain, rpc } from '../core/chain.js';
import { html, render, $, fmtNum, fmtUnits, fmtTime, timeAgo, short, txLink, addrLink, explain, kv, verifyBox, tag, copyBtn, scan } from '../core/ui.js';
import { verifyBlockHash, encodeHeader, HEADER_FIELDS } from '../core/verify.js';
import { rlpFields, fieldsTable, hexBlock } from '../core/raw.js';

const E = () => globalThis.ethers;

const DESC = {
  parentHash: '바로 앞 블록의 해시. 이 값 덕분에 블록들이 사슬처럼 이어진다.',
  sha3Uncles: '엉클 블록 목록의 해시. 작업증명 시절의 유물로 지금은 항상 빈 목록의 해시.',
  miner: '수수료(팁)를 받을 주소. 이 블록을 만든 검증자가 정한다.',
  stateRoot: '이 블록 실행 직후 “모든 계정의 잔액·코드·저장소”를 머클 트리로 요약한 32바이트 지문.',
  transactionsRoot: '이 블록에 담긴 거래 목록 전체의 머클 지문. 거래 하나라도 바뀌면 달라진다.',
  receiptsRoot: '거래 실행 결과(성공 여부, 사용 가스, 이벤트 로그) 목록의 머클 지문.',
  logsBloom: '이벤트 로그를 빠르게 검색하기 위한 256바이트 확률적 필터.',
  difficulty: '작업증명 난이도. 지분증명으로 바뀐 뒤(2022 머지)로는 0.',
  number: '블록 높이. 0번(제네시스)부터 1씩 증가.',
  gasLimit: '이 블록에 담을 수 있는 계산량(가스)의 최대치.',
  gasUsed: '이 블록의 거래들이 실제로 쓴 가스 합계.',
  timestamp: '블록 생성 시각 (유닉스 초).',
  extraData: '블록 만든 쪽이 자유롭게 넣는 메모 (최대 32바이트, 보통 소프트웨어 이름).',
  mixHash: '지분증명에서는 prevRandao — 비콘체인이 만든 난수.',
  nonce: '작업증명용 값. 지금은 항상 0.',
  baseFeePerGas: '가스 1단위당 기본 수수료(EIP-1559). 이 금액 × 사용 가스만큼 코인이 소각된다.',
  withdrawalsRoot: '스테이킹 출금 목록의 머클 지문.',
  blobGasUsed: '롤업용 대용량 데이터(blob)가 쓴 가스.',
  excessBlobGas: 'blob 수수료 산정용 누적 값.',
  parentBeaconBlockRoot: '합의층(비콘체인) 직전 블록의 지문 — 실행층과 합의층을 잇는 고리.',
  requestsHash: '실행층 → 합의층 요청(입금·출금 등) 목록의 지문.',
  blockAccessListHash: '이 블록이 읽고 쓴 계정·저장소 목록의 지문 (최신 하드포크).',
  slotNumber: '비콘체인의 슬롯 번호 (12초 단위 시간 칸).',
};

const fmtField = (k, v) => {
  if (v == null) return '—';
  if (['number', 'gasLimit', 'gasUsed', 'difficulty', 'blobGasUsed', 'excessBlobGas', 'slotNumber'].includes(k)) return html`${fmtNum(BigInt(v))} <span class="muted small">(${v})</span>`;
  if (k === 'timestamp') return html`${fmtTime(v)} <span class="muted small">(${Number(v)})</span>`;
  if (k === 'baseFeePerGas') return html`${fmtNum(BigInt(v))} wei`;
  if (k === 'miner') return addrLink(v, { full: true });
  if (k === 'parentHash') return html`<a class="hash" href="#/blocks/h:${v}">${v}</a>`;
  if (k === 'logsBloom' || k === 'extraData') return html`<span class="hash small">${short(v, 40, 16)}</span>${copyBtn(v)}${k === 'extraData' ? html` <span class="muted small">“${(() => { try { return E().toUtf8String(v); } catch { return ''; } })()}”</span>` : ''}`;
  return html`<span class="hash">${v}</span>`;
};

export default {
  title: '블록',
  async render(view, params, app) {
    const id = params[0] || String(chain.head);
    const block = id.startsWith('h:') ? await rpc('eth_getBlockByHash', [id.slice(2), true]) : await rpc('eth_getBlockByNumber', [E().toQuantity(Number(id)), true]);
    if (!block) return render(view, html`<div class="card"><h2>블록 ${id} 없음</h2></div>`);
    const n = Number(block.number);
    const parent = n > 0 ? await rpc('eth_getBlockByNumber', [E().toQuantity(n - 1), false]) : null;
    const h = verifyBlockHash(block);
    const ours = new Set(Object.values(chain.cfg.contracts || {}).map((a) => a.toLowerCase()));
    const labTxs = block.transactions.filter((t) => (t.to && ours.has(t.to.toLowerCase())) || (chain.cfg.issuer && t.from.toLowerCase() === chain.cfg.issuer.toLowerCase()));
    const burned = BigInt(block.baseFeePerGas || 0) * BigInt(block.gasUsed);

    render(view, html`
      <div class="page-head"><div><h1>블록 #${fmtNum(n)}</h1><div class="sub">${fmtTime(block.timestamp)} · ${timeAgo(block.timestamp)} · 거래 ${fmtNum(block.transactions.length)}건</div></div>
        <span class="spacer"></span>${n > 0 ? html`<a class="btn" href="#/blocks/${n - 1}">← #${n - 1}</a>` : ''}${n < chain.head ? html`<a class="btn" href="#/blocks/${n + 1}">#${n + 1} →</a>` : ''}
        ${scan('block', n, '이더스캔 ↗')}</div>

      <div class="card"><div class="card-head"><h2>직접 검증</h2><span class="muted small">노드를 믿지 않고 이 브라우저에서 다시 계산</span></div>
        ${verifyBox(h.ok, '블록 해시 재계산', html`아래 헤더 필드 ${HEADER_FIELDS.filter(([k]) => block[k] != null).length}개를 RLP 로 묶은 ${fmtNum((h.headerRlp.length - 2) / 2)}바이트 → keccak256 = <span class="hash">${h.computed}</span>`)}
        ${parent ? verifyBox(parent.hash === block.parentHash, '이전 블록과 연결', html`이 블록의 parentHash = #${n - 1} 블록의 해시 <span class="hash">${short(block.parentHash, 10, 8)}</span>`) : ''}
      </div>

      <div class="card"><div class="card-head"><h2>이 블록 속 우리 거래소 거래 ${labTxs.length}건</h2></div>
        ${labTxs.length ? html`<div class="table-wrap"><table><tbody>${labTxs.map((t) => html`<tr><td>${Number(t.transactionIndex)}번째</td><td>${txLink(t.hash)}</td><td>${addrLink(t.from)} → ${t.to ? addrLink(t.to) : '컨트랙트 생성'}</td></tr>`)}</tbody></table></div>`
          : html`<p class="muted">없음. 나머지 ${fmtNum(block.transactions.length)}건은 전 세계 다른 사람들의 시험 거래입니다.</p>`}
        <p class="small muted">이 블록이 태운 기본 수수료: ${E().formatEther(burned)} ${chain.cfg.network.currency.symbol}</p>
      </div>

      <div class="card"><div class="card-head"><h2>헤더 필드</h2><span class="muted small">블록 해시 = keccak256( RLP(아래 필드들) )</span></div>
        ${kv(HEADER_FIELDS.filter(([k]) => block[k] != null).map(([k]) => [html`<code>${k}</code>`, fmtField(k, block[k]), DESC[k] || '']))}
        ${kv([[html`<code>hash</code>`, html`<span class="hash">${block.hash}</span>${copyBtn(block.hash)}`, '위 필드들로 계산되는 이 블록의 지문']])}
      </div>

      <div class="card"><div class="card-head"><h2>헤더 원본 바이트</h2><span class="muted small">위 필드들을 RLP 로 묶은 그대로 — 이 바이트의 keccak256 이 블록 해시</span></div>
        ${fieldsTable(rlpFields(h.headerRlp, HEADER_FIELDS.filter(([k]) => block[k] != null).map(([k, ty]) => ({ name: k, fmt: ty === 'int' ? (x) => (x === '0x' ? '0' : BigInt(x).toLocaleString('ko-KR')) : null }))))}
        <details><summary class="small muted">헤더 전체 바이트 (${fmtNum((h.headerRlp.length - 2) / 2)}바이트)</summary>${hexBlock(h.headerRlp)}</details>
        <details><summary class="small muted">노드가 준 원본 JSON (eth_getBlockByNumber)</summary><pre class="code">${JSON.stringify({ ...block, transactions: `(거래 ${block.transactions.length}건 생략)` }, null, 2)}</pre></details>
      </div>
      <div class="card"><div class="card-head"><h2>변조 실험</h2><span class="muted small">과거 블록을 몰래 고치면?</span></div>
        <div class="row"><select id="tField">${HEADER_FIELDS.filter(([k]) => block[k] != null).map(([k]) => html`<option value="${k}">${k}</option>`)}</select>
          <input id="tValue" class="mono" style="flex:1;min-width:200px" placeholder="바꿀 값 (예: gasUsed 를 999 로)"><button class="btn" id="tRun">해시 다시 계산</button></div>
        <div id="tOut" style="margin-top:10px"></div></div>
      ${explain('이 블록은 누가 만들었나 (지분증명)', html`<p>이더리움은 ETH 를 맡긴(스테이킹) 수십만 검증자 중 12초마다 한 명을 무작위로 뽑아 블록을 제안하게 하고, 다른 검증자들이 투표(증명)합니다.
        이 투표 정보는 ‘합의층(비콘체인)’에 있어 이 실행층 블록에는 parentBeaconBlockRoot 로만 연결됩니다. 거래소 운영자는 블록 생성에 전혀 관여하지 않습니다.</p>`)}
    `);

    $('#tRun', view).addEventListener('click', () => {
      const k = $('#tField', view).value;
      let v = $('#tValue', view).value.trim();
      const type = HEADER_FIELDS.find(([f]) => f === k)[1];
      try {
        if (type === 'int') v = E().toQuantity(BigInt(v || 0));
        else if (!/^0x[0-9a-fA-F]*$/.test(v)) throw new Error('0x 로 시작하는 16진수를 입력하세요');
        const newHash = E().keccak256(encodeHeader({ ...block, [k]: v }));
        render($('#tOut', view), html`<div class="verify bad"><div class="vtitle">${tag('해시 바뀜', 'bad')} ${k} 하나만 바꿨는데</div>
          <div class="small">원래 <span class="hash">${block.hash}</span><br>변조 <span class="hash">${newHash}</span></div></div>
          <p class="small">#${n + 1} 블록은 원래 해시를 parentHash 로 품고 있어 사슬이 끊깁니다. 전 세계 노드가 이 위조 블록을 즉시 거부합니다.</p>`);
      } catch (e) { render($('#tOut', view), html`<span class="badge bad">${e.message}</span>`); }
    });
  },
};
