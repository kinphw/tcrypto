import { chain, rpc, getContract, getEvents, artifact, labelOf, blockTime } from '../core/chain.js';
import { html, render, $, fmtNum, fmtUnits, timeAgo, short, txLink, addrLink, explain, kv, verifyBox, tag, stat, copyBtn, won, scan, raw } from '../core/ui.js';
import { verifyRuntimeCode } from '../core/verify.js';
import { identify } from '../core/abi.js';
import { readAccount, slotOf, mappingSlot, EMPTY_CODE_HASH, EMPTY_STORAGE } from '../core/ledger.js';
import { rlpFields, fieldsTable, hexBlock, proofNodesView, disassemblyView } from '../core/raw.js';

const E = () => globalThis.ethers;

/** 증명 경로를 한 줄로: 분기 → 분기 → 잎 */
const pathLine = (steps) => steps.map((s) => ({ branch: '분기', extension: '확장', leaf: '잎' }[s.kind] || s.kind)).join(' → ');

/** 계정 4칸 카드 */
function anatomyCard(address, r, codeLen) {
  const p = r.proof;
  const isEoa = p.codeHash === EMPTY_CODE_HASH;
  const noStorage = p.storageHash === EMPTY_STORAGE;
  const cur = chain.cfg.network.currency.symbol;
  return html`<div class="card">
    <div class="card-head"><h2>계정 해부 — 이 주소의 장부 칸 4개</h2><span class="muted small">블록 #${fmtNum(Number(r.block.number))} 시점</span></div>
    <p class="small muted">이더리움 장부에는 주소마다 딱 4칸이 있습니다. 노드에 <code>eth_getProof</code> 로 물어 받은 값을 그대로 보여줍니다.</p>
    ${kv([
      [html`<code>nonce</code>`, html`<b>${fmtNum(BigInt(p.nonce))}</b>`, isEoa ? '이 주소가 서명해 보낸 거래 수 (다음 거래 번호)' : '컨트랙트는 1부터 시작해, 다른 컨트랙트를 만들 때마다 1씩 늘어남'],
      [html`<code>balance</code>`, html`<b>${E().formatEther(BigInt(p.balance))} ${cur}</b><br><span class="muted small">${fmtNum(BigInt(p.balance))} wei</span>`, `코인(${cur}) 잔액은 바로 이 칸에 이더리움 시스템이 직접 적습니다`],
      [html`<code>codeHash</code>`, html`<span class="hash small">${p.codeHash}</span>${isEoa ? html`<br>${tag('코드 없음 = 개인키로 움직이는 지갑', 'info')}` : html`<br>${tag(`프로그램 ${fmtNum(codeLen)}바이트의 지문`, 'info')}`}`, '이 주소에 올라간 프로그램(기계어)의 keccak256 지문'],
      [html`<code>storageHash</code>`, html`<span class="hash small">${p.storageHash}</span>${noStorage ? html`<br>${tag('저장공간 비어 있음', 'info')}` : ''}`, '이 주소가 가진 저장공간(표들) 전체를 요약한 머클 루트'],
    ])}
    ${verifyBox(r.account.ok, `노드를 믿지 않고 검증: ${r.account.reason}`,
      html`블록 헤더의 stateRoot <span class="hash">${short(r.block.stateRoot, 8, 6)}</span> 에서 출발해 keccak256(주소) 경로로 증명 노드 ${r.account.steps.length}개를 따라 내려감 (${pathLine(r.account.steps)}). 각 노드의 해시가 부모가 가리킨 값과 모두 일치했습니다.`)}
    ${(() => {
      const last = E().decodeRlp(p.accountProof.at(-1) || '0xc0');
      const leafVal = last.length === 2 && typeof last[1] === 'string' ? last[1] : null;
      return html`<details style="margin:8px 0"><summary class="small"><b>원본 보기</b> — 장부(상태 트리)에 실제로 저장된 이 계정의 바이트와 증명 노드 ${p.accountProof.length}개</summary>
        ${leafVal ? html`<p class="small">상태 트리의 잎에 저장된 값 = RLP[ nonce, balance, storageHash, codeHash ]</p>
          ${fieldsTable(rlpFields(leafVal, [{ name: 'nonce', fmt: (x) => (x === '0x' ? '0' : BigInt(x).toString()) }, { name: 'balance', fmt: (x) => (x === '0x' ? '0' : BigInt(x).toLocaleString('ko-KR') + ' wei') }, { name: 'storageHash' }, { name: 'codeHash' }]))}` : ''}
        <p class="small">이 잎을 찾아가는 경로 = keccak256(주소) = <span class="hash">${E().keccak256(address)}</span> 의 16진수 글자를 하나씩 따라 내려갑니다.</p>
        ${proofNodesView(p.accountProof, E().keccak256(address))}
        <details><summary class="small muted">노드가 준 원본 JSON (eth_getProof)</summary><pre class="code">${JSON.stringify(p, null, 2)}</pre></details>
      </details>`;
    })()}    ${isEoa ? html`<p class="small">이 지갑의 칸에는 <b>원화코인 정보가 전혀 없습니다</b> (${noStorage ? 'storageHash = 빈 저장공간' : '저장공간이 있어도 원화코인과 무관'}). 원화코인 잔액은 아래처럼 <b>원화코인 프로그램의 저장공간</b>에 적혀 있습니다.</p>` : ''}
  </div>`;
}

/** 토큰 잔액이 적힌 칸 찾아가기 카드 */
async function tokenCellCard(holder, tokenAddr, tokenName, symbol) {
  const art = await artifact(tokenName);
  const base = slotOf(art, 'balanceOf');
  const slot = mappingSlot(holder, base);
  const c = await getContract(tokenName, tokenAddr);
  const r = await readAccount(tokenAddr, [slot]);
  const fnBal = await c.balanceOf(holder, { blockTag: r.block.number });
  const cell = r.storage[0];
  const enc = E().AbiCoder.defaultAbiCoder().encode(['address', 'uint256'], [holder, base]);
  return html`<div class="card">
    <div class="card-head"><h2>${symbol} 잔액은 어디에 적혀 있나</h2><span class="muted small">블록 #${fmtNum(Number(r.block.number))} 시점</span></div>
    <ol class="steps">
      <li class="done"><div><b>${symbol} 프로그램(컨트랙트)의 계정 칸</b> ${addrLink(tokenAddr)}<br>
        <span class="small">storageHash <span class="hash">${short(r.proof.storageHash, 10, 8)}</span> — ${r.account.ok ? tag('stateRoot 에서 증명됨', 'ok') : tag('증명 실패', 'bad')}</span></div></li>
      <li class="done"><div><b>변수 배치표 확인</b><br><span class="small">${tokenName}.sol 을 컴파일하면 <code>balanceOf</code> 표(mapping)가 <b>${base}번 칸</b>에 배치됩니다. 표의 각 줄은 계산된 위치에 흩어져 저장돼요.</span></div></li>
      <li class="done"><div><b>이 사람 줄의 위치 계산</b><br><span class="small">keccak256( 주소 32바이트 ‖ ${base} 32바이트 )</span>
        <pre class="code" style="margin-top:4px">${enc.slice(0, 66)}\n  ${'0x' + enc.slice(66)}\n= ${slot}</pre></div></li>
      <li class="done"><div><b>그 칸의 값 읽기</b> <span class="muted small">(eth_getProof 로 증명과 함께)</span><br>
        <span class="hash small">${E().toBeHex(cell.value, 32)}</span> = <b>${fmtNum(cell.value)}</b></div></li>
    </ol>
    ${verifyBox(cell.check.ok, `칸의 값 증명: ${cell.check.reason}`, html`${symbol} 프로그램의 storageHash 에서 출발해 keccak256(칸 위치) 경로로 증명 노드 ${cell.check.steps.length}개를 따라감 (${pathLine(cell.check.steps)}).`)}
    ${verifyBox(fnBal === cell.value, `프로그램 함수로 물어본 값과 비교: balanceOf() = ${fmtNum(fnBal)}`, '함수(프로그램이 계산해 주는 값)와 칸(장부에 실제로 적힌 값)이 같습니다. 지갑·이더스캔이 보여주는 토큰 잔액도 결국 이 칸입니다.')}
    <details style="margin:8px 0"><summary class="small"><b>원본 보기</b> — 저장공간 트리의 증명 노드 ${r.proof.storageProof[0].proof.length}개</summary>
      <p class="small">경로 = keccak256(칸 위치) = <span class="hash">${E().keccak256(slot)}</span></p>
      ${proofNodesView(r.proof.storageProof[0].proof, E().keccak256(slot))}</details>
    <p class="small muted">정리: <b>코인(ETH)</b>은 내 주소의 balance 칸에, <b>토큰</b>은 토큰 프로그램 저장공간의 “내 줄”에 적힙니다. 그래서 토큰을 보내는 거래는 상대가 아니라 토큰 프로그램에게 보내는 것이고, 수수료는 여전히 ETH 로 냅니다.</p>
  </div>`;
}

/** 컨트랙트 저장공간의 단순 변수들 */
async function storageLayoutCard(address, art) {
  const rows = [];
  for (const s of art.storageLayout?.storage || []) {
    const type = art.storageLayout.types[s.type];
    const rawV = await rpc('eth_getStorageAt', [address, E().toQuantity(BigInt(s.slot)), 'latest']);
    let val = '';
    if (type.encoding === 'inplace' && Number(type.numberOfBytes) <= 32) {
      const b = E().getBytes(E().zeroPadValue(rawV, 32));
      const n = Number(type.numberOfBytes), off = s.offset;
      const piece = E().hexlify(b.slice(32 - off - n, 32 - off));
      val = type.label.startsWith('address') ? addrLink(E().getAddress(piece)) : type.label === 'bool' ? (BigInt(piece) ? 'true' : 'false') : type.label.startsWith('uint') ? fmtNum(BigInt(piece)) : piece;
    } else if (type.encoding === 'mapping') val = html`<span class="muted">표(mapping) — 줄마다 keccak256(키 ‖ ${s.slot}) 위치에 저장</span>`;
    else if (type.encoding === 'dynamic_array') val = html`<span class="muted">목록 — 길이 ${fmtNum(BigInt(rawV))}, 항목은 keccak256(${s.slot}) 위치부터</span>`;
    else if (type.encoding === 'bytes') val = html`<span class="muted">문자열</span>`;
    rows.push(html`<tr><td class="num">${s.slot}${s.offset ? '+' + s.offset : ''}</td><td><code>${s.label}</code></td><td class="small">${type.label}</td><td class="hash small">${short(rawV, 8, 6)}</td><td class="break">${val}</td></tr>`);
  }
  if (!rows.length) return '';
  return html`<div class="card"><div class="card-head"><h2>저장공간 배치</h2><span class="muted small">변수마다 32바이트 칸 번호가 정해져 있음 (eth_getStorageAt 원시값)</span></div>
    <div class="table-wrap"><table><thead><tr><th class="num">칸</th><th>변수</th><th>타입</th><th>원시값</th><th>해석</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

export default {
  title: '주소',
  async render(view, params) {
    if (!params[0] || !E().isAddress(params[0])) return render(view, html`<div class="card"><h2>주소 조회</h2><p>위 검색창에 닉네임이나 0x 주소를 넣으세요.</p></div>`);
    const address = E().getAddress(params[0]);
    const net = chain.cfg.network;
    const code = await rpc('eth_getCode', [address, 'latest']);
    const codeLen = (code.length - 2) / 2;

    if (code !== '0x') {
      const name = await identify(address);
      const art = name ? await artifact(name) : null;
      const v = art ? verifyRuntimeCode(code, art) : null;
      render(view, html`
        <div class="page-head"><div><h1>컨트랙트 ${labelOf(address) ? tag(labelOf(address), 'info') : ''}</h1><div class="sub hash">${address} ${copyBtn(address)}</div></div>
          <span class="spacer"></span>${scan('address', address, '이더스캔 ↗')}</div>
        <div id="anatomy" class="loading">장부 칸 읽는 중…</div>
        ${art ? verifyBox(v.ok, `소스 검증: 이 주소의 기계어 = ${art.sourceFile} 를 컴파일한 결과 (${v.reason})`, html`체인 위 코드 ${fmtNum(codeLen)}바이트를 이 거래소의 공개 소스로 다시 컴파일한 결과와 한 바이트씩 비교했습니다. codeHash = keccak256(이 기계어) 입니다.`)
          : html`<div class="verify bad"><div class="vtitle">이 거래소의 소스와 일치하지 않는 컨트랙트입니다</div></div>`}
        <div id="layout"></div>
        <div class="card"><div class="card-head"><h2>기계어 — 장부의 code 칸에 실제로 들어 있는 것</h2><span class="muted small">eth_getCode 원본을 명령어로 풀어 봄</span></div>
          ${disassemblyView(code, art ? Object.fromEntries(new (E().Interface)(art.abi).fragments.filter((f) => f.type === 'function').map((f) => [f.selector, f.name])) : {})}
          <details><summary class="small muted">기계어 원본 바이트 (${fmtNum(codeLen)}바이트)</summary>${hexBlock(code, 32768)}</details></div>        ${art ? html`<details class="card"><summary><b>소스 코드</b> <span class="muted small">체인에 올라간 것은 이 글이 아니라 기계어입니다</span></summary><pre class="code nowrap" style="max-height:520px">${art.source}</pre></details>` : ''}`);
      const r = await readAccount(address);
      render($('#anatomy', view), anatomyCard(address, r, codeLen));
      if (art) render($('#layout', view), await storageLayoutCard(address, art));
      return;
    }

    const [coin, members, market, factory] = await Promise.all(['WonCoin', 'Members', 'Market', 'CoinFactory'].map((n) => getContract(n)));
    const [krw, nick, frozen] = await Promise.all([coin.balanceOf(address), members.nameOf(address), coin.frozen(address)]);
    const topic = E().zeroPadValue(address, 32);
    const [outs, ins, memos, shops, coinsMade] = await Promise.all([
      getEvents(coin, 'Transfer', [topic]), getEvents(coin, 'Transfer', [null, topic]), getEvents(coin, 'Memo'),
      getEvents(market, 'ShopOpened', [null, topic]), getEvents(factory, 'CoinCreated', [null, topic]),
    ]);
    const memoByTx = Object.fromEntries(memos.map(({ ev, log }) => [log.transactionHash, ev.args.memo]));
    const list = [...outs, ...ins].sort((a, b) => b.log.blockNumber - a.log.blockNumber || b.log.index - a.log.index);
    const isIssuer = address.toLowerCase() === chain.cfg.issuer?.toLowerCase();

    render(view, html`
      <div class="page-head"><div><h1>${nick || '이름 없는 지갑'} ${isIssuer ? tag('발행자', 'info') : ''} ${frozen ? tag('동결된 계좌', 'bad') : ''}</h1>
        <div class="sub hash">${address} ${copyBtn(address)}</div></div><span class="spacer"></span>
        <a class="btn" href="#/send/${encodeURIComponent(nick || address)}">이 사람에게 송금</a>${scan('address', address, '이더스캔 ↗')}</div>
      <div class="stats">
        ${stat('원화코인', won(krw), '원화코인 프로그램 장부의 값')}
        ${stat('상점 · 만든 코인', `${shops.length} · ${coinsMade.length}`)}
      </div>
      <div id="anatomy" class="loading">장부 칸 읽는 중…</div>
      <div id="tokencell" class="loading">원화코인 칸 찾는 중…</div>
      ${shops.length || coinsMade.length ? html`<div class="card"><div class="row">${shops.map(({ ev }) => html`<a class="pill" href="#/shop/s/${ev.args.shopId}">${ev.args.name}</a>`)}
        ${coinsMade.map(({ ev }) => html`<a class="pill" href="#/coins">${ev.args.symbol}</a>`)}</div></div>` : ''}
      <div class="card"><div class="card-head"><h2>원화코인 입출금 ${fmtNum(list.length)}건</h2>${scan('token', `${chain.cfg.contracts.WonCoin}?a=${address}`, '이더스캔 토큰 내역 ↗')}</div>
        <div id="hist"></div></div>
      ${explain('감독 관점: 가명이지만 완전 공개', html`<p>주소 하나만 알면 그 주소의 모든 입출금·상대방·시점을 누구나 볼 수 있습니다. 실명 정보는 없지만,
        거래소 입출금 등에서 주소와 실명이 한 번 연결되면 과거 내역 전체가 드러납니다.</p>`, { kind: 'sup' })}
    `);

    (async () => {
      const r = await readAccount(address);
      render($('#anatomy', view), anatomyCard(address, r, 0));
    })().catch((e) => render($('#anatomy', view), html`<div class="card muted">계정 칸을 읽지 못했습니다: ${e.message}</div>`));
    (async () => {
      render($('#tokencell', view), await tokenCellCard(address, chain.cfg.contracts.WonCoin, 'WonCoin', 'sgw'));
    })().catch((e) => render($('#tokencell', view), html`<div class="card muted">원화코인 칸을 읽지 못했습니다: ${e.message}</div>`));

    const rows = await Promise.all(list.slice(0, 200).map(async ({ ev, log }) => {
      const out = ev.args.from.toLowerCase() === address.toLowerCase();
      const other = out ? ev.args.to : ev.args.from;
      return html`<tr><td class="small">${timeAgo(await blockTime(log.blockNumber))}</td><td>${other === E().ZeroAddress ? (out ? tag('소각', 'warn') : tag('발행', 'ok')) : addrLink(other)}</td>
        <td class="num" style="color:var(${out ? '--bad' : '--ok'})">${out ? '-' : '+'}${won(ev.args.value)}</td><td class="small">${memoByTx[log.transactionHash] || ''}</td><td>${txLink(log.transactionHash)}</td></tr>`;
    }));
    render($('#hist', view), rows.length ? html`<div class="table-wrap"><table><thead><tr><th>시각</th><th>상대</th><th class="num">금액</th><th>메모</th><th>거래</th></tr></thead><tbody>${rows}</tbody></table></div>`
      : html`<div class="empty">입출금 없음</div>`);
  },
};
