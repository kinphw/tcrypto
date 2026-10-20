// 쿠폰 시장과 상점가
import { previewFold, bindPreview, dryPay, dryCall } from './trace.js';
import { techFold, app, api, account, html, raw, render, $, $$, won, who, ago, sheet, busy, toast, submit, signCall, signPay, amountPicker, bindAmount, onSettled, addrOfName, shrinkImage, hex } from './core.js';

const me = () => account.address.toLowerCase();
const imgOr = (kind, x, emoji) => (x.image ? html`<img src="/api/img/${kind}/${x.id}" alt="" loading="lazy">` : html`<span class="ph">${emoji}</span>`);
const stepper = (id, max) => html`<div class="stepper"><button type="button" data-d="-1">−</button><input id="${id}" type="number" inputmode="numeric" min="1" ${raw(max ? `max="${max}"` : '')} value="1"><button type="button" data-d="1">＋</button></div>`;
function bindStepper(root, id, max, onChange) {
  const i = $(`#${id}`, root);
  const set = (v) => { i.value = Math.max(1, Math.min(max || 9999, v)); onChange?.(Number(i.value)); };
  $$('[data-d]', root).forEach((b) => b.addEventListener('click', () => set(Number(i.value) + Number(b.dataset.d))));
  i.addEventListener('input', () => onChange?.(Number(i.value)));
  onChange?.(1);
  return () => { const v = Math.floor(Number(i.value)); if (!(v >= 1)) throw new Error('수량을 확인하세요'); if (max && v > max) throw new Error(`최대 ${max}개`); return v; };
}
function photoInput(root, id, out) {
  $(`#${id}`, root).addEventListener('change', async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const r = await shrinkImage(f);
      out.mime = r.mime; out.bytes = r.bytes;
      $(`#${id}Prev`, root).innerHTML = `<img src="${r.url}" alt=""><small>${(r.bytes.length / 1024).toFixed(1)}KB</small>`;
    } catch (err) { toast(err.message, { kind: 'bad' }); }
  });
}

// ───────── 쿠폰 ─────────
export async function coupons(page, params) {
  const draw = async () => {
    const list = await api(`coupons?me=${account.address}`);
    const f = sessionStorage.getItem('tc.cpFilter') || 'market';
    const F = { market: (c) => c.onSale && c.left > 0 && c.creator !== me(), mine: (c) => c.mine > 0, made: (c) => c.creator === me() };
    const shown = list.filter(F[f]);
    render(page, html`
      <section class="head-row"><h1>쿠폰</h1><button class="btn primary" id="new">＋ 쿠폰 만들기</button></section>
      <p class="muted small">“밥 한 끼 사주기권”처럼 약속을 쿠폰으로 만들어 팔거나 선물해요. 받은 사람이 쓰면 만든 사람이 약속을 지켜요.</p>
      <div class="seg">${[['market', '시장'], ['mine', '내 쿠폰'], ['made', '내가 만든']].map(([k, t]) => html`<button data-f="${k}" class="${k === f ? 'on' : ''}">${t}</button>`)}</div>
      ${shown.length ? html`<div class="grid">${shown.map((c) => html`<a class="tile" href="#/coupons/${c.id}">
          <div class="pic">${imgOr('coupon', c, '🎟')}${c.mine ? html`<span class="badge">${c.mine}장 보유</span>` : ''}</div>
          <b>${c.name}</b><span class="muted small">${who(c.creator)}</span>
          <span class="price">${c.onSale ? html`${won(c.price)} <small>phw</small>` : html`<small class="muted">선물 전용</small>`}</span>
          <span class="muted small">남은 ${c.left}/${c.supply}${c.redeemed ? ` · 사용 ${c.redeemed}` : ''}</span></a>`)}</div>`
        : html`<div class="empty"><div class="big-emoji">🎟</div><p>${f === 'market' ? '팔고 있는 쿠폰이 없어요' : f === 'mine' ? '가진 쿠폰이 없어요' : '아직 만든 쿠폰이 없어요'}</p></div>`}`);
    $$('[data-f]', page).forEach((b) => b.addEventListener('click', () => { sessionStorage.setItem('tc.cpFilter', b.dataset.f); draw(); }));
    $('#new', page).addEventListener('click', createCoupon);
    return list;
  };
  const list = await draw();
  if (params[0]) {
    const c = list.find((x) => x.id === Number(params[0]));
    if (c) couponSheet(c).closed.then(() => { if (location.hash.startsWith('#/coupons/')) history.replaceState(null, '', '#/coupons'); });
  }
  const off = onSettled(() => draw().catch(() => {}));
  return () => off();
}

function couponSheet(c) {
  const isCreator = c.creator === me();
  return sheet(html`
    <div class="cp-hero">${imgOr('coupon', c, '🎟')}</div>
    <h2>${c.name}</h2>
    <p class="muted small">${who(c.creator)} 님이 만든 쿠폰 · 남은 ${c.left}/${c.supply}장 · 사용 ${c.redeemed}장</p>
    ${c.description ? html`<p>${c.description}</p>` : ''}
    ${techFold([['쿠폰 컨트랙트', app.cfg.contracts.Coupons, 'addr'], ['쿠폰 번호', String(c.id)], ['만든 사람', c.creator, 'addr'], ['원본', { price: c.price, supply: c.supply, sold: c.sold, redeemed: c.redeemed, onSale: c.onSale }, 'json']])}
    ${c.mine ? html`<div class="mybox">내가 가진 쿠폰 <b>${c.mine}장</b></div>` : ''}
    ${!isCreator && c.onSale && c.left > 0 ? html`<div class="block"><h3>사기 · ${won(c.price)} phw</h3>${stepper('n', c.left)}<div class="balline">합계 <b id="tot"></b> · 지갑 ${won(app.me.sgw)} phw</div><button class="btn primary big" id="buy">사기</button>${previewFold('pvcb')}</div>` : ''}
    ${c.mine ? html`<div class="block"><h3>쓰기</h3><input id="note" maxlength="100" placeholder="만든 사람에게 남길 말 (예: 금요일 저녁에!)"><button class="btn primary" id="use">1장 쓰기</button>${previewFold('pvuse')}</div>
      <div class="block"><h3>선물하기</h3><input id="to" list="ppl" placeholder="받을 친구 닉네임"><datalist id="ppl">${Object.values(app.names).sort().map((n) => html`<option value="${n}">`)}</datalist>
        <input id="msg" maxlength="100" placeholder="메시지 (선택)"><button class="btn" id="gift">1장 선물</button>${previewFold('pvgift')}</div>` : ''}
    ${isCreator ? html`<div class="block"><h3>판매 설정</h3><div class="row"><input id="price" type="number" min="0" value="${c.price}" style="width:120px"><span>phw</span>
        <button class="btn" id="sale">${c.onSale ? '가격 바꾸기' : '판매 시작'}</button>${c.onSale ? html`<button class="btn ghost" id="stop">판매 중지</button>` : ''}</div></div>
      <div class="block"><h3>사용 기록</h3>${c.uses?.length ? html`<ul class="list">${c.uses.map((u) => html`<li><b>${who(u.holder)}</b> ${u.amount}장<span class="muted">${u.note || ''} · ${ago(u.time)}</span></li>`)}</ul>` : html`<p class="muted small">아직 아무도 쓰지 않았어요</p>`}</div>` : ''}`, {
    onMount: (b, close) => {
      if ($('#buy', b)) {
        const get = bindStepper(b, 'n', c.left, (n) => { $('#tot', b).textContent = `${won(n * c.price)} phw`; });
        bindPreview(b, () => { const n = Math.max(1, Math.floor(Number($('#n', b).value)) || 1); return dryPay('cbuy', app.cfg.contracts.Coupons, n * c.price, { couponId: c.id, amount: n }); }, 'pvcb');
        $('#buy', b).addEventListener('click', busy($('#buy', b), async () => {
          const n = get();
          const total = n * c.price;
          if (total > app.me.sgw) throw new Error('지갑 잔액이 부족해요. 홈에서 충전하세요');
          const obj = await signPay('cbuy', app.cfg.contracts.Coupons, total, { couponId: c.id, amount: n, label: `쿠폰 “${c.name}” ${n}장` });
          close(); await submit(obj, `“${c.name}” ${n}장 구매`);
        }));
      }
      if ($('#use', b)) bindPreview(b, () => dryCall('Coupons', 'redeem', [c.id, 1, $('#note', b).value.trim()], { gas: 250000 }), 'pvuse');
      if ($('#gift', b)) bindPreview(b, () => dryCall('Coupons', 'gift', [globalThis.ethers.getAddress(addrOfName($('#to', b).value.trim()) || '0x0000000000000000000000000000000000000000'), c.id, 1, $('#msg', b).value.trim()], { gas: 250000 }), 'pvgift');
      $('#use', b)?.addEventListener('click', busy($('#use', b), async () => {
        if (!confirm(`“${c.name}” 1장을 쓸까요? 쓰면 사라지고 ${who(c.creator)} 님에게 알림이 가요.`)) return;
        const obj = await signCall('Coupons', 'redeem', [c.id, 1, $('#note', b).value.trim()], { gas: 250000 });
        close(); await submit(obj, `“${c.name}” 사용`);
      }));
      $('#gift', b)?.addEventListener('click', busy($('#gift', b), async () => {
        const to = addrOfName($('#to', b).value.trim());
        if (!to) throw new Error('그런 닉네임이 없어요');
        if (to === me()) throw new Error('나에게는 선물할 수 없어요');
        const obj = await signCall('Coupons', 'gift', [globalThis.ethers.getAddress(to), c.id, 1, $('#msg', b).value.trim()], { gas: 250000 });
        close(); await submit(obj, `“${c.name}” 선물`);
      }));
      $('#sale', b)?.addEventListener('click', busy($('#sale', b), async () => {
        const p = Math.floor(Number($('#price', b).value));
        if (!(p > 0)) throw new Error('가격은 1 phw 이상');
        close(); await submit(await signCall('Coupons', 'setSale', [c.id, p, true], { gas: 150000 }), `“${c.name}” ${won(p)} phw 판매`);
      }));
      $('#stop', b)?.addEventListener('click', busy($('#stop', b), async () => { close(); await submit(await signCall('Coupons', 'setSale', [c.id, 0, false], { gas: 150000 }), `“${c.name}” 판매 중지`); }));
    },
  });
}

function createCoupon() {
  const photo = {};
  sheet(html`<h2>쿠폰 만들기</h2>
    <label class="lbl">이름</label><input id="name" maxlength="20" placeholder="예) 밥 한 끼 사주기권">
    <label class="lbl">설명</label><input id="desc" maxlength="100" placeholder="조건이나 유효기간 (선택)">
    <label class="lbl">사진 (선택)</label><label class="photo"><input id="pic" type="file" accept="image/*" hidden><span id="picPrev">＋ 사진 고르기</span></label>
    <div class="row2"><div><label class="lbl">장수</label><input id="supply" type="number" min="1" max="1000" value="3"></div>
      <div><label class="lbl">가격 (phw)</label><input id="price" type="number" min="0" value="5000"><p class="hint">0 이면 팔지 않고 선물만</p></div></div>
    <p class="hint">공개 기록에 남아요. 실명·연락처는 넣지 마세요.</p>
    <button class="btn primary big" id="go">만들기</button>`, {
    onMount: (b, close) => {
      photoInput(b, 'pic', photo);
      $('#go', b).addEventListener('click', busy($('#go', b), async () => {
        const name = $('#name', b).value.trim();
        const supply = Math.floor(Number($('#supply', b).value));
        const price = Math.floor(Number($('#price', b).value)) || 0;
        if (!name) throw new Error('이름을 써 주세요');
        if (!(supply >= 1 && supply <= 1000)) throw new Error('장수는 1~1000');
        const obj = await signCall('Coupons', 'create', [name, $('#desc', b).value.trim(), photo.mime || '', photo.bytes ? hex(photo.bytes) : '0x', supply, price], { gas: 2_000_000 });
        close(); await submit(obj, `쿠폰 “${name}” 만들기`);
        sessionStorage.setItem('tc.cpFilter', 'made');
      }));
    },
  });
}

// ───────── 상점 ─────────
export async function shop(page) {
  const draw = async () => {
    const { shops, products, orders = [] } = await api(`shop?me=${account.address}`);
    const myShops = shops.filter((s) => s.owner === me());
    const live = products.filter((p) => p.active && p.stock > 0 && p.shop?.open).reverse();
    render(page, html`
      <section class="head-row"><h1>상점</h1>${myShops.length ? '' : html`<button class="btn primary" id="open">＋ 가게 열기</button>`}</section>
      ${live.length ? html`<div class="grid">${live.map((p) => html`<button class="tile" data-p="${p.id}">
          <div class="pic">${imgOr('product', p, '🛍')}</div><b>${p.name}</b><span class="muted small">${p.shop?.name} · ${who(p.shop?.owner)}</span>
          <span class="price">${won(p.price)} <small>phw</small></span><span class="muted small">재고 ${p.stock}${p.sold ? ` · ${p.sold}개 팔림` : ''}</span></button>`)}</div>`
        : html`<div class="empty"><div class="big-emoji">🛍</div><p>아직 파는 물건이 없어요</p></div>`}
      ${myShops.map((s) => html`<section class="card"><div class="card-head"><h2>내 가게 · ${s.name}${s.open ? '' : html` <span class="tag cancelled">문 닫음</span>`}</h2><button class="btn small" data-list="${s.id}">＋ 상품 올리기</button></div>
        <ul class="list">${products.filter((p) => p.shopId === s.id).map((p) => html`<li><span><b>${p.name}</b><br><span class="muted small">${won(p.price)} phw · 재고 ${p.stock} · ${p.sold}개 팔림${p.active ? '' : ' · 판매 중지'}</span></span><button class="btn small" data-edit="${p.id}">수정</button></li>`)}</ul>
        <button class="btn ghost small" data-shop="${s.id}" data-open="${s.open ? '0' : '1'}">${s.open ? '가게 문 닫기 (잠시 쉬기)' : '가게 문 열기'}</button>
        ${orders.length ? html`<h3>받은 주문</h3><ul class="list">${orders.map((o) => html`<li><b>${who(o.buyer)}</b> ${o.name} ×${o.quantity}<span class="muted">${won(o.total)} phw${o.note ? ` · “${o.note}”` : ''} · ${ago(o.time)}</span></li>`)}</ul>` : ''}</section>`)}`);
    $$('[data-p]', page).forEach((b) => b.addEventListener('click', () => buySheet(products.find((p) => p.id === Number(b.dataset.p)))));
    $('#open', page)?.addEventListener('click', openShop);
    $$('[data-list]', page).forEach((b) => b.addEventListener('click', () => listProduct(Number(b.dataset.list))));
    $$('[data-edit]', page).forEach((b) => b.addEventListener('click', () => editProduct(products.find((p) => p.id === Number(b.dataset.edit)))));
    $$('[data-shop]', page).forEach((b) => b.addEventListener('click', busy(b, async () => {
      const open = b.dataset.open === '1';
      await submit(await signCall('Market', 'setShopOpen', [Number(b.dataset.shop), open], { gas: 150000 }), open ? '가게 문 열기' : '가게 문 닫기');
    })));
  };
  await draw();
  const off = onSettled(() => draw().catch(() => {}));
  return () => off();
}

function buySheet(p) {
  const mineShop = p.shop?.owner === me();
  sheet(html`<div class="cp-hero">${imgOr('product', p, '🛍')}</div><h2>${p.name}</h2>
    <p class="muted small">${p.shop?.name} · ${who(p.shop?.owner)} · 재고 ${p.stock}</p>${p.description ? html`<p>${p.description}</p>` : ''}
    ${techFold([['상점가 컨트랙트', app.cfg.contracts.Market, 'addr'], ['상품 번호', String(p.id)], ['가게 주인', p.shop?.owner, 'addr']])}
    ${mineShop ? html`<p class="muted">내 가게 상품이에요</p>` : html`${stepper('n', p.stock)}<input id="note" maxlength="100" placeholder="가게에 남길 말 (선택)">
      <div class="balline">합계 <b id="tot"></b> · 지갑 ${won(app.me.sgw)} phw</div><button class="btn primary big" id="buy">사기</button>${previewFold('pvpb')}`}`, {
    onMount: (b, close) => {
      if (mineShop) return;
      const get = bindStepper(b, 'n', p.stock, (n) => { $('#tot', b).textContent = `${won(n * p.price)} phw`; });
      bindPreview(b, () => { const n = Math.max(1, Math.floor(Number($('#n', b).value)) || 1); return dryPay('buy', app.cfg.contracts.Market, n * p.price, { productId: p.id, quantity: n, note: $('#note', b).value.trim() }); }, 'pvpb');
      $('#buy', b).addEventListener('click', busy($('#buy', b), async () => {
        const n = get();
        const total = n * p.price;
        if (total > app.me.sgw) throw new Error('지갑 잔액이 부족해요. 홈에서 충전하세요');
        const obj = await signPay('buy', app.cfg.contracts.Market, total, { productId: p.id, quantity: n, note: $('#note', b).value.trim(), label: `${p.name} ×${n}` });
        close(); await submit(obj, `${p.name} ×${n} 구매`);
      }));
    },
  });
}

function openShop() {
  sheet(html`<h2>가게 열기</h2><label class="lbl">가게 이름</label><input id="name" maxlength="20" placeholder="예) 민수네 떡볶이">
    <label class="lbl">소개</label><input id="desc" maxlength="100" placeholder="(선택)"><button class="btn primary big" id="go">열기</button>`, {
    onMount: (b, close) => $('#go', b).addEventListener('click', busy($('#go', b), async () => {
      const name = $('#name', b).value.trim();
      if (!name) throw new Error('가게 이름을 써 주세요');
      const obj = await signCall('Market', 'openShop', [name, $('#desc', b).value.trim()], { gas: 400000 });
      close(); await submit(obj, `가게 “${name}” 열기`);
    })),
  });
}

function editProduct(p) {
  sheet(html`<h2>${p.name} 수정</h2>
    <div class="row2"><div><label class="lbl">가격 (phw)</label><input id="price" type="number" min="1" value="${p.price}"></div><div><label class="lbl">재고</label><input id="stock" type="number" min="0" value="${p.stock}"></div></div>
    <label class="row" style="margin-top:12px"><input id="active" type="checkbox" style="width:auto" ${p.active ? 'checked' : ''}> 판매 중</label>
    <button class="btn primary big" id="go">저장</button>`, {
    onMount: (b, close) => $('#go', b).addEventListener('click', busy($('#go', b), async () => {
      const price = Math.floor(Number($('#price', b).value));
      const stock = Math.floor(Number($('#stock', b).value));
      if (!(price > 0) || !(stock >= 0)) throw new Error('가격·재고를 확인하세요');
      const obj = await signCall('Market', 'updateProduct', [p.id, price, stock, $('#active', b).checked], { gas: 150000 });
      close(); await submit(obj, `“${p.name}” 수정`);
    })),
  });
}

function listProduct(shopId) {
  const photo = {};
  sheet(html`<h2>상품 올리기</h2><label class="lbl">이름</label><input id="name" maxlength="30">
    <label class="lbl">설명</label><input id="desc" maxlength="100" placeholder="(선택)">
    <label class="lbl">사진 (선택)</label><label class="photo"><input id="pic" type="file" accept="image/*" hidden><span id="picPrev">＋ 사진 고르기</span></label>
    <div class="row2"><div><label class="lbl">가격 (phw)</label><input id="price" type="number" min="1" value="3000"></div><div><label class="lbl">재고</label><input id="stock" type="number" min="1" value="10"></div></div>
    <button class="btn primary big" id="go">올리기</button>`, {
    onMount: (b, close) => {
      photoInput(b, 'pic', photo);
      $('#go', b).addEventListener('click', busy($('#go', b), async () => {
        const name = $('#name', b).value.trim();
        const price = Math.floor(Number($('#price', b).value));
        const stock = Math.floor(Number($('#stock', b).value));
        if (!name || !(price > 0) || !(stock > 0)) throw new Error('이름·가격·재고를 확인하세요');
        const obj = await signCall('Market', 'listProduct', [shopId, name, $('#desc', b).value.trim(), price, stock, photo.mime || '', photo.bytes ? hex(photo.bytes) : '0x'], { gas: 2_000_000 });
        close(); await submit(obj, `상품 “${name}” 올리기`);
      }));
    },
  });
}
