// 화면 조립용 작은 도우미들. 프레임워크 없이 템플릿 문자열로 HTML 을 만든다.
const E = () => globalThis.ethers;

class Raw {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}
export const raw = (s) => new Raw(String(s));

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const piece = (v) => (v instanceof Raw ? v.s : Array.isArray(v) ? v.map(piece).join('') : v === false || v == null ? '' : esc(v));

/** html`...${값}...` — 값은 자동으로 이스케이프된다. raw()/html`` 결과는 그대로 들어간다. */
export function html(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => { out += piece(v) + strings[i + 1]; });
  return new Raw(out);
}

export function render(el, content) {
  if (!el) return null; // 화면이 이미 바뀌어 대상 요소가 사라진 경우
  el.innerHTML = piece(content);
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ── 숫자·시간 ──
export function fmtUnits(v, decimals = 18, maxFrac = 4) {
  const n = BigInt(v);
  const s = E().formatUnits(n < 0n ? -n : n, decimals);
  const [i, f = ''] = s.split('.');
  const frac = f.replace(/0+$/, '').slice(0, maxFrac);
  return (n < 0n ? '-' : '') + BigInt(i).toLocaleString('ko-KR') + (frac ? '.' + frac : '');
}
export const fmtNum = (n) => Number(n).toLocaleString('ko-KR');
export function timeAgo(ts) {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - Number(ts)));
  if (s < 60) return `${s}초 전`;
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return `${Math.floor(s / 86400)}일 전`;
}
export const fmtTime = (ts) => new Date(Number(ts) * 1000).toLocaleString('ko-KR');
export const short = (h, a = 6, b = 4) => (h && h.length > a + b + 2 ? `${h.slice(0, a + 2)}…${h.slice(-b)}` : h || '');

// ── 링크 ──
export const copyBtn = (text) => html`<button class="copy" data-copy="${text}" title="복사">⧉</button>`;
export const blockLink = (n) => html`<a href="#/blocks/${Number(n)}">#${fmtNum(Number(n))}</a>`;
export const txLink = (h, full = false) => html`<a class="hash" href="#/tx/${h}">${full ? h : short(h, 8, 6)}</a>`;

let labeler = () => null;
export function setLabeler(fn) { labeler = fn; }
export function addrLink(a, { full = false, copy = false } = {}) {
  if (!a) return html`<span class="muted">—</span>`;
  const addr = E().getAddress(a);
  const label = labeler(addr);
  return html`<a class="hash" href="#/address/${addr}" title="${addr}">${full ? addr : short(addr, 6, 4)}</a>${label ? html`<span class="addr-tag">${label}</span>` : ''}${copy ? copyBtn(addr) : ''}`;
}

// ── 외부 탐색기(이더스캔) 링크 ──
let explorerBase = null;
export function setExplorer(base) { explorerBase = base; }
/** kind: tx | address | block | token. 이더스캔이 없는 망(로컬 시험망)이면 빈 값 */
export function scan(kind, id, text = '이더스캔 ↗') {
  if (!explorerBase) return '';
  return html`<a class="scan" href="${explorerBase}/${kind}/${id}" target="_blank" rel="noopener" title="이더스캔(외부)에서 같은 기록 보기">${text}</a>`;
}

// ── 원화 금액 ──
export const won = (v) => `${BigInt(v).toLocaleString('ko-KR')} sgw`;

// ── 블록 요소 ──
export const badge = (ok, yes = '일치', no = '불일치') => html`<span class="badge ${ok ? 'ok' : 'bad'}">${ok ? '✓ ' + yes : '✗ ' + no}</span>`;
export const tag = (text, kind = '') => html`<span class="badge ${kind}">${text}</span>`;

/** 접을 수 있는 해설 상자. kind='sup' 이면 '감독 관점' 색상 */
export function explain(title, body, { open = false, kind = '' } = {}) {
  return html`<details class="explain ${kind}" ${open ? raw('open') : ''}><summary>${title}</summary>${body}</details>`;
}

/** [이름, 값, 설명] 행 배열 → 키-값 표 */
export function kv(rows) {
  return html`<div class="table-wrap"><table class="kv"><tbody>${rows.filter(Boolean).map(
    ([k, v, d]) => html`<tr><td>${k}</td><td class="break">${v}</td>${d !== undefined ? html`<td class="desc">${d}</td>` : ''}</tr>`,
  )}</tbody></table></div>`;
}

export function verifyBox(ok, title, body) {
  return html`<div class="verify ${ok ? 'ok' : 'bad'}"><div class="vtitle">${badge(ok, '검증됨', '검증 실패')} ${title}</div>${body ? html`<div class="small" style="margin-top:6px">${body}</div>` : ''}</div>`;
}

export function stat(label, value, hint) {
  return html`<div class="stat"><div class="label">${label}</div><div class="value">${value}</div>${hint ? html`<div class="hint">${hint}</div>` : ''}</div>`;
}

export function avatar(addr, name) {
  const hue = parseInt(addr.slice(2, 6), 16) % 360;
  const ch = (name || addr.slice(2, 4)).slice(0, 1).toUpperCase();
  return html`<div class="avatar" style="background:hsl(${hue} 55% 48%)">${ch}</div>`;
}

/** 간단한 선 그래프 (SVG). points: [{x, y}] */
export function lineChart(points, { yFmt = (v) => v, xFmt = (v) => v } = {}) {
  if (points.length < 2) return html`<div class="empty">데이터가 부족합니다</div>`;
  const W = 600, H = 180, P = { l: 70, r: 10, t: 10, b: 22 };
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  if (y0 === y1) { y0 -= 1; y1 += 1; }
  const X = (x) => P.l + ((x - x0) / (x1 - x0 || 1)) * (W - P.l - P.r);
  const Y = (y) => P.t + (1 - (y - y0) / (y1 - y0)) * (H - P.t - P.b);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
  const area = `${d}L${X(x1)},${H - P.b}L${X(x0)},${H - P.b}Z`;
  const ticks = [y0, (y0 + y1) / 2, y1];
  return raw(`<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    ${ticks.map((t) => `<line class="grid-line" x1="${P.l}" x2="${W - P.r}" y1="${Y(t)}" y2="${Y(t)}"/><text x="${P.l - 6}" y="${Y(t) + 3}" text-anchor="end">${esc(yFmt(t))}</text>`).join('')}
    <path class="area" d="${area}"/><path class="line" d="${d}"/>
    <text x="${P.l}" y="${H - 6}">${esc(xFmt(x0))}</text><text x="${W - P.r}" y="${H - 6}" text-anchor="end">${esc(xFmt(x1))}</text>
  </svg>`);
}

// ── 대화상자 ──
export function openModal(content) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><button class="modal-x" aria-label="닫기">✕</button><div class="modal-body"></div></div>`;
  wrap.querySelector('.modal-body').innerHTML = piece(content);
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.querySelector('.modal-x').addEventListener('click', close);
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  return close;
}

// ── 알림 ──
export function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.remove(), kind === 'bad' ? 8000 : 4000);
}

/** 거래·호출 에러에서 사람이 읽을 수 있는 이유를 뽑는다 */
export function errMsg(e) {
  if (!e) return '알 수 없는 오류';
  if (e.code === 'ACTION_REJECTED' || e.code === 4001) return '지갑에서 서명을 거절했습니다';
  return e.reason || e.shortMessage || e.info?.error?.message || e.error?.message || e.message || String(e);
}

/** 버튼을 누르면 비동기 작업 실행, 그동안 버튼 비활성화 */
export async function busy(btn, fn) {
  const label = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '처리 중…';
  try { return await fn(); }
  catch (e) { toast(errMsg(e), 'bad'); console.error(e); }
  finally { btn.disabled = false; btn.innerHTML = label; }
}

// 전역: 복사 버튼
document.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-copy]');
  if (!b) return;
  navigator.clipboard?.writeText(b.dataset.copy).then(() => toast('복사했습니다'));
});
