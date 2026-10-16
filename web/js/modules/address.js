import { chain, rpc, getContract, getEvents, artifact, labelOf, blockTime } from '../core/chain.js';
import { html, render, $, fmtNum, fmtUnits, timeAgo, short, txLink, addrLink, explain, kv, verifyBox, tag, stat, copyBtn, won, scan } from '../core/ui.js';
import { verifyRuntimeCode } from '../core/verify.js';
import { identify } from '../core/abi.js';

const E = () => globalThis.ethers;

export default {
  title: '주소',
  async render(view, params) {
    if (!params[0] || !E().isAddress(params[0])) return render(view, html`<div class="card"><h2>주소 조회</h2><p>위 검색창에 닉네임이나 0x 주소를 넣으세요.</p></div>`);
    const address = E().getAddress(params[0]);
    const net = chain.cfg.network;
    const code = await rpc('eth_getCode', [address, 'latest']);

    if (code !== '0x') {
      const name = await identify(address);
      const art = name ? await artifact(name) : null;
      const v = art ? verifyRuntimeCode(code, art) : null;
      render(view, html`
        <div class="page-head"><div><h1>컨트랙트 ${labelOf(address) ? tag(labelOf(address), 'info') : ''}</h1><div class="sub hash">${address} ${copyBtn(address)}</div></div>
          <span class="spacer"></span>${scan('address', address, '이더스캔 ↗')}</div>
        ${art ? verifyBox(v.ok, `소스 검증: 이 주소의 기계어 = ${art.sourceFile} 를 컴파일한 결과 (${v.reason})`, html`체인 위 코드 ${fmtNum((code.length - 2) / 2)}바이트를 이 실험실의 공개 소스(${art.compiler.version.split('+')[0]}, 최적화 ${art.compiler.settings.optimizer.runs}회)로 다시 컴파일한 결과와 한 바이트씩 비교했습니다.`)
          : html`<div class="verify bad"><div class="vtitle">이 실험실의 소스와 일치하지 않는 컨트랙트입니다</div><div class="small">이더스캔의 Contract 탭에서 작성자가 소스를 공개했는지 확인해 보세요.</div></div>`}
        ${art ? html`<div class="card"><div class="card-head"><h2>소스 코드</h2><span class="muted small">체인에 올라간 것은 이 글이 아니라 기계어입니다. 그래서 ‘소스 검증’이 필요합니다.</span></div>
          <pre class="code nowrap" style="max-height:520px">${art.source}</pre></div>` : ''}
        ${explain('스마트컨트랙트란', html`<p>블록체인에 올려 둔 프로그램입니다. 한 번 배포하면 코드를 고칠 수 없고, 누구나 호출할 수 있으며, 전 세계 노드가 똑같이 실행합니다.
          위 원화코인·상점가 규칙(누가 발행할 수 있는지, 언제 결제가 실패하는지)은 전부 이 코드에 적혀 있고, 운영자도 코드 밖의 일은 할 수 없습니다.</p>`)}`);
      return;
    }

    const [coin, members, market, factory] = await Promise.all(['WonCoin', 'Members', 'Market', 'CoinFactory'].map((n) => getContract(n)));
    const [krw, eth, nick, frozen, nonce] = await Promise.all([coin.balanceOf(address), chain.provider.getBalance(address), members.nameOf(address), coin.frozen(address), chain.provider.getTransactionCount(address)]);
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
        ${stat('원화코인', won(krw))}
        ${stat(net.currency.symbol, fmtUnits(eth, 18, 6), '수수료용')}
        ${stat('보낸 거래 수 (논스)', fmtNum(nonce), '이 주소가 서명한 모든 거래 (실험실 밖 포함)')}
        ${stat('상점 · 만든 코인', `${shops.length} · ${coinsMade.length}`)}
      </div>
      ${shops.length || coinsMade.length ? html`<div class="card"><div class="row">${shops.map(({ ev }) => html`<a class="pill" href="#/shop/s/${ev.args.shopId}">🏪 ${ev.args.name}</a>`)}
        ${coinsMade.map(({ ev }) => html`<a class="pill" href="#/coins">◈ ${ev.args.symbol}</a>`)}</div></div>` : ''}
      <div class="card"><div class="card-head"><h2>원화코인 입출금 ${fmtNum(list.length)}건</h2>${scan('token', `${chain.cfg.contracts.WonCoin}?a=${address}`, '이더스캔 토큰 내역 ↗')}</div>
        <div id="hist"></div></div>
      ${explain('감독 관점: 가명이지만 완전 공개', html`<p>주소 하나만 알면 그 주소의 모든 입출금·상대방·시점을 누구나 볼 수 있습니다. 실명 정보는 없지만,
        거래소 입출금 등에서 주소와 실명이 한 번 연결되면 과거 내역 전체가 드러납니다. 자금세탁방지(AML)·트래블룰 감독이 주소 분석에 기반하는 이유입니다.</p>`, { kind: 'sup' })}
    `);

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
