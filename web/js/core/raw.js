// 블록체인에 '실제로 저장되는 바이트'를 그대로 펼쳐 보여주는 도구.
// 이더리움은 거래·블록 헤더·장부 노드를 모두 RLP 라는 방식으로 바이트에 묶어 저장하고, 그 바이트의 keccak256 이 곧 '지문(해시)'이다.
import { html, short, fmtNum } from './ui.js';

const E = () => globalThis.ethers;
const len = (hex) => (hex.length - 2) / 2;

/** RLP 의 맨 앞 '머리' 바이트가 뜻하는 것 */
function rlpPrefix(bytes, off) {
  const b = bytes[off];
  if (b < 0x80) return { kind: '값', head: 1, body: 0, note: `머리 없음 — 0x${b.toString(16).padStart(2, '0')} 한 바이트가 곧 값` };
  if (b <= 0xb7) return { kind: '값', head: 1, body: b - 0x80, note: `머리 0x${b.toString(16)} = “뒤 ${b - 0x80}바이트가 값”` };
  if (b < 0xc0) { const n = b - 0xb7; let l = 0; for (let i = 1; i <= n; i++) l = l * 256 + bytes[off + i]; return { kind: '값', head: 1 + n, body: l, note: `머리 0x${b.toString(16)} + 길이 ${n}바이트 = “뒤 ${l}바이트가 값”` }; }
  if (b <= 0xf7) return { kind: '목록', head: 1, body: b - 0xc0, note: `머리 0x${b.toString(16)} = “뒤 ${b - 0xc0}바이트가 목록”` };
  const n = b - 0xf7; let l = 0; for (let i = 1; i <= n; i++) l = l * 256 + bytes[off + i];
  return { kind: '목록', head: 1 + n, body: l, note: `머리 0x${b.toString(16)} + 길이 ${n}바이트 = “뒤 ${l}바이트가 목록”` };
}

/**
 * RLP 로 묶인 목록 하나를 칸별로 펼친다.
 * fields: [{ name, fmt? }] 순서대로 이름표. 반환: { outer, rows: [{ name, offset, head, value, note, shown }] }
 */
export function rlpFields(hex, fields = [], offsetBase = 0) {
  const bytes = E().getBytes(hex);
  const top = rlpPrefix(bytes, 0);
  let off = top.head;
  const rows = [];
  let i = 0;
  while (off < bytes.length) {
    const p = rlpPrefix(bytes, off);
    const valBytes = p.head + p.body === 1 && bytes[off] < 0x80 ? bytes.slice(off, off + 1) : bytes.slice(off + p.head, off + p.head + p.body);
    const value = E().hexlify(valBytes);
    const f = fields[i] || { name: `#${i}` };
    rows.push({ name: f.name, desc: f.desc, offset: offsetBase + off, headHex: E().hexlify(bytes.slice(off, off + p.head)), value, kind: p.kind, note: p.note, shown: f.fmt ? f.fmt(value) : null });
    off += p.head + p.body;
    i++;
  }
  return { outer: top, rows, size: bytes.length };
}

const asInt = (v) => (v === '0x' ? '0' : BigInt(v).toLocaleString('ko-KR'));
const asAddr = (v) => (v === '0x' ? '(비어 있음 = 컨트랙트 생성)' : E().getAddress(v));

export const TX_FIELDS = {
  0: [{ name: 'nonce', fmt: asInt }, { name: 'gasPrice', fmt: (v) => asInt(v) + ' wei' }, { name: 'gasLimit', fmt: asInt }, { name: 'to', fmt: asAddr }, { name: 'value', fmt: (v) => asInt(v) + ' wei' }, { name: 'data' }, { name: 'v', fmt: asInt }, { name: 'r' }, { name: 's' }],
  1: [{ name: 'chainId', fmt: asInt }, { name: 'nonce', fmt: asInt }, { name: 'gasPrice', fmt: (v) => asInt(v) + ' wei' }, { name: 'gasLimit', fmt: asInt }, { name: 'to', fmt: asAddr }, { name: 'value', fmt: (v) => asInt(v) + ' wei' }, { name: 'data' }, { name: 'accessList' }, { name: 'yParity', fmt: asInt }, { name: 'r' }, { name: 's' }],
  2: [{ name: 'chainId', fmt: asInt, desc: '어느 체인용 서명인지' }, { name: 'nonce', fmt: asInt, desc: '보낸 사람의 거래 번호' }, { name: 'maxPriorityFeePerGas', fmt: (v) => asInt(v) + ' wei', desc: '검증자 팁 상한' },
    { name: 'maxFeePerGas', fmt: (v) => asInt(v) + ' wei', desc: '가스당 최대 수수료' }, { name: 'gasLimit', fmt: asInt, desc: '최대 계산량' }, { name: 'to', fmt: asAddr, desc: '받는 곳' },
    { name: 'value', fmt: (v) => asInt(v) + ' wei', desc: '보내는 코인' }, { name: 'data', desc: '실행할 함수와 인자' }, { name: 'accessList', desc: '미리 선언한 접근 목록 (보통 빈 목록)' },
    { name: 'yParity', fmt: asInt, desc: '서명 — 복원 힌트 1비트' }, { name: 'r', desc: '서명 앞 32바이트' }, { name: 's', desc: '서명 뒤 32바이트' }],
};

/** 표 하나로: 칸 이름 | 위치(바이트) | 머리 | 값(hex) | 해석 */
export function fieldsTable(parsed) {
  return html`<div class="table-wrap"><table><thead><tr><th>칸</th><th class="num">위치</th><th>머리</th><th>원본 값 (hex)</th><th>해석</th></tr></thead><tbody>
    ${parsed.rows.map((r) => html`<tr><td><code>${r.name}</code>${r.desc ? html`<br><span class="muted small">${r.desc}</span>` : ''}</td>
      <td class="num small">${r.offset}</td><td class="hash small" title="${r.note}">${r.headHex}</td>
      <td class="hash small break">${len(r.value) > 96 ? html`${r.value.slice(0, 98)}… <span class="muted">(${fmtNum(len(r.value))}바이트)</span>` : r.value === '0x' ? html`<span class="muted">0x (빈 값)</span>` : r.value}</td>
      <td class="small break">${r.shown ?? ''}</td></tr>`)}
  </tbody></table></div>
  <p class="small muted">‘머리’는 RLP 가 각 칸 앞에 붙이는 길이 표시입니다 (마우스를 올리면 뜻이 보입니다). 맨 앞 목록 머리: ${parsed.outer.note}. 전체 ${fmtNum(parsed.size)}바이트.</p>`;
}

/** 긴 hex 를 줄 단위(32바이트)로 */
export function hexBlock(hex, maxBytes = 4096) {
  const body = hex.slice(2, 2 + maxBytes * 2);
  const lines = [];
  for (let i = 0; i < body.length; i += 64) lines.push(`${String(i / 2).padStart(5, ' ')}  ${body.slice(i, i + 64)}`);
  if (len(hex) > maxBytes) lines.push(`… (전체 ${len(hex).toLocaleString()}바이트 중 앞 ${maxBytes.toLocaleString()}바이트)`);
  return html`<pre class="code nowrap">${lines.join('\n')}</pre>`;
}

/** 32바이트 단위로 쪼갠 데이터 (이벤트 data 등) */
export function words(hex) {
  const b = hex.slice(2);
  const out = [];
  for (let i = 0; i < b.length; i += 64) out.push('0x' + b.slice(i, i + 64));
  return out;
}

// ───────── 머클 증명 노드 해부 ─────────
const toNib = (hex) => [...E().getBytes(hex)].flatMap((x) => [x >> 4, x & 15]);

/** 증명 노드 하나(RLP 바이트)가 무엇을 담고 있는지 */
export function describeNode(nodeRlp, takeNibble) {
  const node = E().decodeRlp(nodeRlp);
  if (node.length === 17) {
    return html`<div class="small"><b>분기 노드</b> — 다음 16진수 한 글자(0~f)마다 아래 노드의 해시 칸 16개 + 값 칸 1개
      <div class="table-wrap"><table><tbody>${node.slice(0, 16).map((c, i) => html`<tr${i === takeNibble ? html` style="background:var(--accent-soft)"` : ''}>
        <td class="num"><code>${i.toString(16)}</code></td><td class="hash small">${Array.isArray(c) ? '(내장 노드)' : c === '0x' ? html`<span class="muted">비어 있음</span>` : c}</td><td class="small">${i === takeNibble ? '← 이 경로로 내려감' : ''}</td></tr>`)}
      </tbody></table></div></div>`;
  }
  const nb = toNib(node[0]);
  const leaf = nb[0] >= 2;
  const part = nb[0] % 2 ? nb.slice(1) : nb.slice(2);
  const val = Array.isArray(node[1]) ? '(내장 노드)' : node[1];
  return html`<div class="small"><b>${leaf ? '잎 노드' : '확장 노드'}</b> — 경로 조각 <code>${part.map((x) => x.toString(16)).join('')}</code>
    (첫 바이트 ${E().hexlify(E().getBytes(node[0]).slice(0, 1))} = ${leaf ? '잎' : '확장'}·${nb[0] % 2 ? '홀수' : '짝수'} 길이 표시)
    <br>${leaf ? '값' : '다음 노드 해시'}: <span class="hash break">${typeof val === 'string' && len(val) > 200 ? val.slice(0, 200) + '…' : val}</span></div>`;
}

/** 증명 노드 전체 목록 (경로상 몇 번째 글자를 따라갔는지 강조) */
export function proofNodesView(nodes, keyHash) {
  const path = toNib(keyHash);
  let depth = 0;
  return html`${nodes.map((n, i) => {
    const node = E().decodeRlp(n);
    let take = null;
    if (node.length === 17) { take = path[depth]; depth++; }
    else { const nb = toNib(node[0]); depth += (nb[0] % 2 ? nb.slice(1) : nb.slice(2)).length; }
    return html`<details class="verify" style="margin:6px 0"><summary class="small"><b>${i + 1}번째 노드</b> · ${fmtNum(len(n))}바이트 · 해시 <span class="hash">${short(E().keccak256(n), 8, 6)}</span></summary>
      ${describeNode(n, take)}<div class="small muted" style="margin-top:6px">원본 바이트</div>${hexBlock(n, 1024)}</details>`;
  })}`;
}

// ───────── 기계어(바이트코드) → 명령어 ─────────
const OPS = {
  0x00: 'STOP', 0x01: 'ADD', 0x02: 'MUL', 0x03: 'SUB', 0x04: 'DIV', 0x05: 'SDIV', 0x06: 'MOD', 0x07: 'SMOD', 0x08: 'ADDMOD', 0x09: 'MULMOD', 0x0a: 'EXP', 0x0b: 'SIGNEXTEND',
  0x10: 'LT', 0x11: 'GT', 0x12: 'SLT', 0x13: 'SGT', 0x14: 'EQ', 0x15: 'ISZERO', 0x16: 'AND', 0x17: 'OR', 0x18: 'XOR', 0x19: 'NOT', 0x1a: 'BYTE', 0x1b: 'SHL', 0x1c: 'SHR', 0x1d: 'SAR',
  0x20: 'KECCAK256', 0x30: 'ADDRESS', 0x31: 'BALANCE', 0x32: 'ORIGIN', 0x33: 'CALLER', 0x34: 'CALLVALUE', 0x35: 'CALLDATALOAD', 0x36: 'CALLDATASIZE', 0x37: 'CALLDATACOPY',
  0x38: 'CODESIZE', 0x39: 'CODECOPY', 0x3a: 'GASPRICE', 0x3b: 'EXTCODESIZE', 0x3c: 'EXTCODECOPY', 0x3d: 'RETURNDATASIZE', 0x3e: 'RETURNDATACOPY', 0x3f: 'EXTCODEHASH',
  0x40: 'BLOCKHASH', 0x41: 'COINBASE', 0x42: 'TIMESTAMP', 0x43: 'NUMBER', 0x44: 'PREVRANDAO', 0x45: 'GASLIMIT', 0x46: 'CHAINID', 0x47: 'SELFBALANCE', 0x48: 'BASEFEE', 0x49: 'BLOBHASH', 0x4a: 'BLOBBASEFEE',
  0x50: 'POP', 0x51: 'MLOAD', 0x52: 'MSTORE', 0x53: 'MSTORE8', 0x54: 'SLOAD', 0x55: 'SSTORE', 0x56: 'JUMP', 0x57: 'JUMPI', 0x58: 'PC', 0x59: 'MSIZE', 0x5a: 'GAS', 0x5b: 'JUMPDEST',
  0x5c: 'TLOAD', 0x5d: 'TSTORE', 0x5e: 'MCOPY', 0x5f: 'PUSH0',
  0xa0: 'LOG0', 0xa1: 'LOG1', 0xa2: 'LOG2', 0xa3: 'LOG3', 0xa4: 'LOG4',
  0xf0: 'CREATE', 0xf1: 'CALL', 0xf2: 'CALLCODE', 0xf3: 'RETURN', 0xf4: 'DELEGATECALL', 0xf5: 'CREATE2', 0xfa: 'STATICCALL', 0xfd: 'REVERT', 0xfe: 'INVALID', 0xff: 'SELFDESTRUCT',
};
for (let i = 1; i <= 32; i++) OPS[0x5f + i] = `PUSH${i}`;
for (let i = 1; i <= 16; i++) { OPS[0x7f + i] = `DUP${i}`; OPS[0x8f + i] = `SWAP${i}`; }
const OP_KO = { SSTORE: '저장공간에 쓰기', SLOAD: '저장공간 읽기', CALLER: '호출한 주소', CALLVALUE: '함께 보낸 코인', CALLDATALOAD: '입력 데이터 읽기', JUMPI: '조건 분기', JUMPDEST: '분기 도착점',
  LOG1: '이벤트 기록(토픽1)', LOG2: '이벤트 기록(토픽2)', LOG3: '이벤트 기록(토픽3)', LOG4: '이벤트 기록(토픽4)', KECCAK256: '해시 계산', CALL: '다른 계정 호출', REVERT: '거절하고 되돌리기', RETURN: '결과 돌려주기',
  EQ: '같은지 비교', CREATE: '새 컨트랙트 만들기', TIMESTAMP: '블록 시각' };

export function disassemble(code, max = 400) {
  const b = E().getBytes(code);
  const out = [];
  let pc = 0;
  while (pc < b.length && out.length < max) {
    const op = b[pc];
    const name = OPS[op] || `(데이터 0x${op.toString(16).padStart(2, '0')})`;
    let arg = '';
    if (op >= 0x60 && op <= 0x7f) { const n = op - 0x5f; arg = E().hexlify(b.slice(pc + 1, pc + 1 + n)); out.push({ pc, op, name, arg }); pc += 1 + n; continue; }
    out.push({ pc, op, name, arg });
    pc++;
  }
  return { ops: out, total: b.length, done: pc >= b.length };
}

export function disassemblyView(code, selectors = {}) {
  const d = disassemble(code);
  return html`<div class="table-wrap" style="max-height:480px;overflow:auto"><table><thead><tr><th class="num">위치</th><th>바이트</th><th>명령</th><th>뒤따르는 값</th><th>뜻</th></tr></thead><tbody>
    ${d.ops.map((o) => html`<tr><td class="num small">${o.pc}</td><td class="hash small">${o.op.toString(16).padStart(2, '0')}</td><td><code>${o.name}</code></td>
      <td class="hash small">${o.arg}${o.arg && selectors[o.arg] ? html` <span class="badge info">${selectors[o.arg]}</span>` : ''}</td><td class="small muted">${OP_KO[o.name] || ''}</td></tr>`)}
  </tbody></table></div>
  <p class="small muted">${d.done ? '전체' : `앞부분 ${d.ops.length}개 명령`} (전체 ${fmtNum(d.total)}바이트). 프로그램 맨 앞에서 입력 데이터의 앞 4바이트(함수 선택자)를 꺼내 각 함수의 선택자와 차례로 비교(EQ)하고, 맞는 곳으로 분기(JUMPI)합니다 — 파란 표시가 그 함수 이름입니다.
    맨 끝에는 컴파일러 정보(메타데이터)가 데이터로 붙어 있습니다.</p>`;
}
