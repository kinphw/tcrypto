import { chain, wallet, getContract, getEvents, writable, track, blockTime, requireWallet } from '../core/chain.js';
import { html, render, $, $$, fmtNum, timeAgo, short, txLink, addrLink, explain, tag, kv, busy, toast, won, raw, scan } from '../core/ui.js';
import { notReady } from './home.js';

const E = () => globalThis.ethers;
const MAX_IMAGE = 22_000; // 컨트랙트 한도 24,000 바이트 이내
const SAFE_MIME = /^image\/(png|jpeg|webp|gif)$/;

/** 사진을 블록체인에 올릴 크기(≤22KB)로 줄인다 */
async function compressImage(file) {
  const img = await createImageBitmap(file);
  let scale = Math.min(1, 640 / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  for (let attempt = 0; attempt < 10; attempt++) {
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    for (const q of [0.8, 0.65, 0.5, 0.38]) {
      let blob = await new Promise((r) => canvas.toBlob(r, 'image/webp', q));
      if (!blob || blob.type !== 'image/webp') blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', q));
      if (blob.size <= MAX_IMAGE) return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: blob.type, note: `${canvas.width}×${canvas.height}` };
    }
    scale *= 0.75;
  }
  throw new Error('사진을 충분히 줄이지 못했습니다');
}

const imgUrls = new Map();
function imageUrl(p) {
  if (!p.image || E().dataLength(p.image) === 0 || !SAFE_MIME.test(p.mime)) return null;
  if (!imgUrls.has(p.id)) imgUrls.set(p.id, URL.createObjectURL(new Blob([E().getBytes(p.image)], { type: p.mime })));
  return imgUrls.get(p.id);
}

/** 상점·상품을 이벤트(이름·사진)와 현재 상태(가격·재고)로 모은다 */
async function loadMarket() {
  const m = await getContract('Market');
  const [shopEvs, prodEvs] = await Promise.all([getEvents(m, 'ShopOpened'), getEvents(m, 'ProductListed')]);
  const shops = new Map();
  await Promise.all(shopEvs.map(async ({ ev }) => {
    const id = Number(ev.args.shopId);
    const s = await m.getShop(id);
    shops.set(id, { id, owner: s.owner, open: s.open, name: s.name, description: s.description, openedAt: Number(s.openedAt) });
  }));
  const products = new Map();
  await Promise.all(prodEvs.map(async ({ ev, log }) => {
    const id = Number(ev.args.productId);
    const p = await m.getProduct(id);
    products.set(id, {
      id, shopId: Number(p.shopId), name: p.name, description: ev.args.description, price: p.price, stock: p.stock, sold: p.sold,
      active: p.active, mime: ev.args.mime, image: ev.args.image, imageHash: p.imageHash, tx: log.transactionHash,
    });
  }));
  return { m, shops, products };
}

function productCard(p, shop) {
  const url = imageUrl(p);
  const soldout = p.stock === 0n || !p.active || !shop?.open;
  return html`<a class="product ${soldout ? 'soldout' : ''}" href="#/shop/p/${p.id}">
    <div class="thumb">${url ? html`<img src="${url}" alt="${p.name}" loading="lazy">` : '사진 없음'}</div>
    <div class="info"><span class="shopname">${shop?.name || ''}</span><b>${p.name}</b>
      <span class="price">${won(p.price)}</span>
      <span class="small muted">${!shop?.open ? '상점 휴업' : !p.active ? '판매 중지' : p.stock === 0n ? '품절' : `재고 ${fmtNum(p.stock)} · 판매 ${fmtNum(p.sold)}`}</span></div></a>`;
}

// ───────── 상점가 첫 화면 ─────────
async function renderMall(view, app) {
  const { shops, products } = await loadMarket();
  const list = [...products.values()].sort((a, b) => b.id - a.id);
  render(view, html`
    <div class="page-head"><div><h1>상점가</h1><div class="sub">누구나 상점을 열고, 서길원(sgw)으로 사고팝니다 · 가상 상품이며 실제 배송은 없습니다</div></div>
      <span class="spacer"></span><a class="btn btn-primary" href="#/shop/mine">내 상점 관리</a></div>
    ${explain('결제는 어떻게 이루어지나', html`<p>상품을 사면 <b>상점가 컨트랙트</b>가 재고를 줄이고, 같은 거래 안에서 원화코인을 <b>구매자 → 상점 주인</b>에게 직접 옮깁니다.
      중간에 돈을 맡아 두는 회사가 없고, 재고 감소와 결제가 함께 성공하거나 함께 실패합니다(원자성).</p>
      <p>처음 구매할 때는 “상점가 컨트랙트가 내 원화코인을 N원까지 꺼내 갈 수 있다”는 <b>결제 허용(approve)</b> 서명이 한 번 더 필요합니다. 실제 이더리움의 모든 토큰 결제가 이 방식입니다.</p>`)}
    <div class="card"><div class="card-head"><h2>상점 ${shops.size}곳</h2></div>
      <div class="row">${[...shops.values()].map((s) => html`<a class="pill" href="#/shop/s/${s.id}">${s.open ? '' : '(휴업) '}${s.name} <span class="muted">· ${chain.members[s.owner.toLowerCase()] || short(s.owner)}</span></a>`)}
      ${shops.size ? '' : html`<span class="muted">아직 상점이 없습니다. 첫 상점을 열어 보세요!</span>`}</div></div>
    <div class="products">${list.map((p) => productCard(p, shops.get(p.shopId)))}</div>
    ${list.length ? '' : html`<div class="empty">아직 등록된 상품이 없습니다</div>`}
  `);
}

// ───────── 상점 페이지 ─────────
async function renderShop(view, id, app) {
  const { m, shops, products } = await loadMarket();
  const s = shops.get(id);
  if (!s) return render(view, html`<div class="card"><h2>${id}번 상점이 없습니다</h2></div>`);
  const orders = await getEvents(m, 'Purchased', [null, null, E().toBeHex(id, 32)]);
  const sales = orders.reduce((a, { ev }) => a + ev.args.total, 0n);
  render(view, html`
    <div class="page-head"><div><h1>${s.name} ${s.open ? '' : tag('휴업', 'warn')}</h1><div class="sub">${s.description}</div>
      <div class="sub">주인 ${addrLink(s.owner)} · ${fmtNum(orders.length)}건 판매 · 매출 ${won(sales)}</div></div>
      <span class="spacer"></span><a class="btn" href="#/shop">← 상점가</a></div>
    <div class="products">${[...products.values()].filter((p) => p.shopId === id).sort((a, b) => b.id - a.id).map((p) => productCard(p, s))}</div>
    <div class="card" style="margin-top:16px"><h2>판매 기록</h2>${orderTable(orders, products)}</div>`);
}

function orderTable(orders, products) {
  if (!orders.length) return html`<div class="empty">아직 판매가 없습니다</div>`;
  return html`<div class="table-wrap"><table><thead><tr><th>주문</th><th>상품</th><th>구매자</th><th class="num">수량</th><th class="num">금액</th><th>요청사항</th><th>거래</th></tr></thead><tbody>
    ${orders.slice().reverse().map(({ ev, log }) => html`<tr><td>#${ev.args.orderId}</td><td><a href="#/shop/p/${ev.args.productId}">${products.get(Number(ev.args.productId))?.name || '#' + ev.args.productId}</a></td>
      <td>${addrLink(ev.args.buyer)}</td><td class="num">${fmtNum(ev.args.quantity)}</td><td class="num">${won(ev.args.total)}</td><td class="small">${ev.args.note}</td><td>${txLink(log.transactionHash)}</td></tr>`)}
  </tbody></table></div>`;
}

// ───────── 상품 상세 · 구매 ─────────
async function renderProduct(view, id, app, first = true) {
  const { m, shops, products } = await loadMarket();
  const p = products.get(id);
  if (!p) return render(view, html`<div class="card"><h2>${id}번 상품이 없습니다</h2></div>`);
  const s = shops.get(p.shopId);
  const coin = await getContract('WonCoin');
  const me = wallet.address;
  const marketAddr = chain.cfg.contracts.Market;
  const url = imageUrl(p);

  const draw = async () => {
    const [bal, allowance] = me ? await Promise.all([coin.balanceOf(me), coin.allowance(me, marketAddr)]) : [0n, 0n];
    const fresh = await m.getProduct(id);
    p.stock = fresh.stock; p.sold = fresh.sold; p.price = fresh.price; p.active = fresh.active;
    const canBuy = s.open && p.active && p.stock > 0n;
    render(view, html`
      <div class="page-head"><a class="btn" href="#/shop/s/${s.id}">← ${s.name}</a></div>
      <div class="grid grid-2">
        <div>${url ? html`<img class="detail-img" src="${url}" alt="${p.name}">` : html`<div class="product"><div class="thumb">사진 없음</div></div>`}
          ${url ? html`<p class="small muted">사진 ${fmtNum(E().dataLength(p.image))}바이트가 <a href="#/tx/${p.tx}">상품 등록 거래</a>의 이벤트 로그에 들어 있습니다.</p>` : ''}</div>
        <div class="card">
          <span class="muted">${s.name} · 주인 ${addrLink(s.owner)}</span>
          <h1>${p.name}</h1>
          <div class="big-num">${won(p.price)}</div>
          <p style="white-space:pre-wrap">${p.description}</p>
          <p class="small muted">재고 ${fmtNum(p.stock)} · 지금까지 ${fmtNum(p.sold)}개 판매 ${!canBuy ? tag(!s.open ? '상점 휴업' : !p.active ? '판매 중지' : '품절', 'warn') : ''}</p>
          <div class="row"><label for="qty" class="small">수량</label><input id="qty" type="number" min="1" step="1" value="1" style="width:90px">
            <input id="note" placeholder="요청사항 (선택)" style="flex:1;min-width:140px"></div>
          <p class="small" id="sum" style="margin-top:8px"></p>
          <ol class="steps" style="margin:10px 0">
            <li id="st1"><div><b>결제 허용 (approve)</b><br><span class="small muted">상점가 컨트랙트가 내 원화코인을 정해진 금액까지 꺼내 갈 수 있게 허락합니다. 현재 허용액 ${won(allowance)}</span></div></li>
            <li id="st2"><div><b>구매 (buy)</b><br><span class="small muted">재고 감소 + 원화코인 이전이 한 거래로 처리됩니다.</span></div></li>
          </ol>
          <button class="btn btn-primary" id="buy" ${canBuy && me ? '' : raw('disabled')}>구매하기</button>
          ${me ? html`<p class="small muted" style="margin-top:6px">내 잔액 ${won(bal)}</p>` : html`<p class="small muted">구매하려면 <a href="#/home">MetaMask 연결</a>이 필요합니다.</p>`}
        </div>
      </div>`);
    const upd = () => {
      const q = BigInt(Math.max(1, Number($('#qty', view).value) || 1));
      const total = p.price * q;
      $('#sum', view).textContent = `합계 ${won(total)}${me && bal < total ? ' — 잔액이 부족합니다' : ''}`;
      $('#st1', view).classList.toggle('done', allowance >= total);
      return total;
    };
    $('#qty', view).addEventListener('input', upd);
    upd();
    $('#buy', view).addEventListener('click', (ev) => busy(ev.target, async () => {
      requireWallet();
      const q = BigInt($('#qty', view).value || '1');
      const total = upd();
      if (bal < total) throw new Error(`잔액이 부족합니다 (필요 ${won(total)}, 보유 ${won(bal)}). 내 지갑에서 충전을 요청하세요.`);
      if (s.owner.toLowerCase() === me.toLowerCase()) throw new Error('내 상점 상품은 살 수 없습니다');
      if (allowance < total) {
        toast('1단계: 결제 허용 — MetaMask 에서 “지출 한도”를 확인하고 승인하세요');
        const r1 = await track((await writable(coin)).approve(marketAddr, total), '결제 허용');
        if (r1.status !== 1) return;
      }
      toast('2단계: 구매 — MetaMask 에서 승인하세요');
      const r2 = await track((await writable(m)).buy(id, q, $('#note', view).value.trim()), '구매');
      if (r2.status === 1) location.hash = `#/tx/${r2.hash}`;
      else await draw();
    }));
  };
  await draw();
  if (first) app.onWallet(() => renderProduct(view, id, app, false));
}

// ───────── 내 상점 관리 ─────────
async function renderMine(view, app) {
  const me = wallet.address;
  if (!me) return render(view, html`<div class="card"><h2>내 상점 관리</h2><p><a href="#/home">MetaMask 를 연결</a>하면 상점을 열 수 있습니다.</p></div>`);
  const { m, shops, products } = await loadMarket();
  const mine = [...shops.values()].filter((s) => s.owner.toLowerCase() === me.toLowerCase());
  const myOrders = (await getEvents(m, 'Purchased')).filter(({ ev }) => ev.args.seller.toLowerCase() === me.toLowerCase());

  render(view, html`
    <div class="page-head"><div><h1>내 상점 관리</h1><div class="sub">상점 열기 · 상품 올리기 · 판매 확인</div></div><span class="spacer"></span><a class="btn" href="#/shop">← 상점가</a></div>
    <div class="card"><h2>새 상점 열기</h2>
      <div class="row"><input id="sName" maxlength="40" placeholder="상점 이름 (예: 철수네 붕어빵)" style="flex:1;min-width:180px"><input id="sDesc" maxlength="150" placeholder="한 줄 소개" style="flex:2;min-width:200px">
        <button class="btn btn-primary" id="open">상점 열기</button></div></div>
    ${mine.map((s) => html`<div class="card" data-shop="${s.id}">
      <div class="card-head"><h2>${s.name}</h2>${s.open ? tag('영업 중', 'ok') : tag('휴업', 'warn')}<a class="small" href="#/shop/s/${s.id}">상점 보기 →</a><span class="spacer"></span>
        <button class="btn small" data-toggle="${s.open ? 0 : 1}">${s.open ? '휴업하기' : '영업 재개'}</button></div>
      <h3>상품 올리기</h3>
      <div class="row"><input data-f="name" maxlength="60" placeholder="상품명" style="flex:2;min-width:150px"><input data-f="price" type="number" min="1" placeholder="가격(sgw)" style="width:120px">
        <input data-f="stock" type="number" min="0" placeholder="재고" style="width:90px"></div>
      <textarea data-f="desc" rows="2" maxlength="300" placeholder="상품 설명" style="margin-top:6px"></textarea>
      <div class="row" style="margin-top:6px"><label class="btn small">사진 선택<input type="file" accept="image/*" data-f="file" hidden></label><span class="small muted" data-f="fileInfo">사진은 선택 사항 (자동으로 ${fmtNum(MAX_IMAGE)}바이트 이하로 줄임)</span>
        <span class="spacer"></span><button class="btn btn-primary" data-list>상품 올리기</button></div>
      <h3 style="margin-top:14px">내 상품</h3>
      ${[...products.values()].filter((p) => p.shopId === s.id).length ? html`<div class="table-wrap"><table><thead><tr><th>상품</th><th class="num">가격</th><th class="num">재고</th><th class="num">판매</th><th>판매 중</th><th></th></tr></thead><tbody>
        ${[...products.values()].filter((p) => p.shopId === s.id).map((p) => html`<tr data-prod="${p.id}"><td><a href="#/shop/p/${p.id}">${p.name}</a></td>
          <td class="num"><input data-e="price" type="number" value="${p.price.toString()}" style="width:100px"></td>
          <td class="num"><input data-e="stock" type="number" value="${p.stock.toString()}" style="width:80px"></td>
          <td class="num">${fmtNum(p.sold)}</td><td><input data-e="active" type="checkbox" ${p.active ? raw('checked') : ''}></td>
          <td><button class="btn small" data-save>저장</button></td></tr>`)}</tbody></table></div>` : html`<div class="empty small">아직 상품이 없습니다</div>`}
    </div>`)}
    <div class="card"><h2>받은 주문 (${fmtNum(myOrders.length)}건, 매출 ${won(myOrders.reduce((a, { ev }) => a + ev.args.total, 0n))})</h2>${orderTable(myOrders, products)}</div>
  `);

  $('#open', view).addEventListener('click', (ev) => busy(ev.target, async () => {
    const n = $('#sName', view).value.trim();
    if (!n) throw new Error('상점 이름을 입력하세요');
    await track((await writable(m)).openShop(n, $('#sDesc', view).value.trim()), '상점 열기');
    await renderMine(view, app);
  }));

  for (const card of $$('[data-shop]', view)) {
    const shopId = Number(card.dataset.shop);
    let attach = null;
    card.querySelector('[data-f="file"]').addEventListener('change', async (ev) => {
      const f = ev.target.files[0];
      const info = card.querySelector('[data-f="fileInfo"]');
      if (!f) return;
      info.textContent = '사진 줄이는 중…';
      try {
        attach = await compressImage(f);
        info.textContent = `${fmtNum(f.size)} → ${fmtNum(attach.bytes.length)}바이트 (${attach.mime}, ${attach.note})`;
      } catch (e) { attach = null; info.textContent = e.message; }
    });
    card.querySelector('[data-toggle]').addEventListener('click', (ev) => busy(ev.target, async () => {
      await track((await writable(m)).setShopOpen(shopId, ev.target.dataset.toggle === '1'), '상점 상태 변경');
      await renderMine(view, app);
    }));
    card.querySelector('[data-list]').addEventListener('click', (ev) => busy(ev.target, async () => {
      const get = (k) => card.querySelector(`[data-f="${k}"]`).value.trim();
      if (!get('name')) throw new Error('상품명을 입력하세요');
      if (!/^\d+$/.test(get('price')) || BigInt(get('price')) <= 0n) throw new Error('가격을 1 sgw 이상 정수로 입력하세요');
      const stock = /^\d+$/.test(get('stock')) ? BigInt(get('stock')) : 0n;
      await track((await writable(m)).listProduct(shopId, get('name'), get('desc'), BigInt(get('price')), stock, attach?.mime || '', attach?.bytes || new Uint8Array()), '상품 올리기');
      await renderMine(view, app);
    }));
    for (const row of card.querySelectorAll('[data-prod]')) {
      row.querySelector('[data-save]').addEventListener('click', (ev) => busy(ev.target, async () => {
        const g = (k) => row.querySelector(`[data-e="${k}"]`);
        await track((await writable(m)).updateProduct(Number(row.dataset.prod), BigInt(g('price').value || '0'), BigInt(g('stock').value || '0'), g('active').checked), '상품 수정');
        await renderMine(view, app);
      }));
    }
  }
}

export default {
  title: '상점가',
  async render(view, params, app) {
    if (!chain.ready) return notReady(view);
    app.cleanup(() => {});
    if (params[0] === 'p') return renderProduct(view, Number(params[1]), app);
    if (params[0] === 's') return renderShop(view, Number(params[1]), app);
    if (params[0] === 'mine') return renderMine(view, app);
    return renderMall(view, app);
  },
};
