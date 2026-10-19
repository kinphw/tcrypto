// 대납 요청함: 서명된 요청을 공개 우편함(ntfy.sh)에 넣고, 발행자(또는 누구든) 화면이 꺼내 읽는다.
// 실제 서비스라면 지갑 앱이 회사 서버(릴레이어)로 보내는 부분이다. 여기서는 그 '서버'를 누구나 들여다볼 수 있는 공개 우편함으로 대신한다.
//  - 보내기: POST https://ntfy.sh/<주제>  (본문 = 아래 봉투 JSON 한 통)
//  - 읽기  : GET  https://ntfy.sh/<주제>/json?poll=1&since=12h  (한 줄에 메시지 하나)
// 우편함은 아무나 읽고 쓸 수 있지만, 서명을 위조할 수는 없다 → 읽는 쪽이 서명을 검증해 가짜를 걸러 낸다.
import { chain, getContract, getEvents } from './chain.js';
import { encodePayload, decodePayload, verifyRelay } from './relay.js';

const E = () => globalThis.ethers;
export const APP = 'cheongna-sgw';
const CHUNK = 3000; // ntfy 메시지 한 통 한도(4096바이트)를 넘지 않도록 나눠 보냄
export const KEEP_HOURS = 12; // ntfy.sh 무료 보관 기간

/** 설정의 우편함 주소 (없으면 체인·서길원 주소로 만든 이름) */
export function inboxInfo() {
  const c = chain.cfg;
  const url = (c.inbox?.url || 'https://ntfy.sh').replace(/\/$/, '');
  const topic = c.inbox?.topic || `${APP}-${c.network.chainId}-${(c.contracts?.Seogilwon || '0x').slice(2, 10).toLowerCase()}`;
  return { url, topic, web: `${url}/${topic}`, publish: `${url}/${topic}`, poll: `${url}/${topic}/json?poll=1&since=${KEEP_HOURS}h` };
}

/** 서명 객체 → 우편함에 넣기. 봉투(ASCII JSON)에 압축된 서명을 담고, 길면 여러 통으로 나눈다. */
export async function postRequest(obj) {
  const { publish } = inboxInfo();
  const v = verifyRelay(obj);
  const payload = await encodePayload(obj);
  const parts = payload.match(new RegExp(`.{1,${CHUNK}}`, 'g'));
  for (let i = 0; i < parts.length; i++) {
    const envelope = { app: APP, v: 1, id: v.digest, i, n: parts.length, k: obj.k, from: v.expected, p: parts[i] };
    const r = await fetch(publish, { method: 'POST', body: JSON.stringify(envelope) });
    if (!r.ok) throw new Error(`요청함 전송 실패 (HTTP ${r.status})`);
  }
  return { id: v.digest, parts: parts.length };
}

/** 우편함 원문 그대로 (화면의 '원본 보기'용) */
export async function fetchRaw() {
  const r = await fetch(inboxInfo().poll, { cache: 'no-store' });
  if (!r.ok) throw new Error(`요청함을 읽지 못했습니다 (HTTP ${r.status})`);
  return (await r.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((m) => m.event === 'message');
}

/** 우편함 읽기 → 조각 합치기 → 해독 → 서명 검증. 위조·깨진 것은 bad 로 분리 */
export async function readInbox() {
  const raw = await fetchRaw();
  const groups = new Map();
  for (const m of raw) {
    let env;
    try { env = JSON.parse(m.message); } catch { continue; }
    if (env?.app !== APP || typeof env.id !== 'string') continue;
    const g = groups.get(env.id) || { id: env.id, n: env.n, parts: [], time: m.time, msgIds: [] };
    g.parts[env.i] = env.p;
    g.time = Math.min(g.time, m.time);
    g.msgIds.push(m.id);
    groups.set(env.id, g);
  }
  const ok = [];
  const bad = [];
  for (const g of groups.values()) {
    if (g.parts.filter((x) => x != null).length !== g.n) { bad.push({ ...g, why: '조각이 덜 도착함' }); continue; }
    const payload = g.parts.join('');
    try {
      const obj = await decodePayload(payload);
      if (obj.chainId !== chain.cfg.network.chainId) { bad.push({ ...g, why: '다른 네트워크용' }); continue; }
      const v = verifyRelay(obj);
      if (!v.ok || v.digest !== g.id) { bad.push({ ...g, why: '서명 불일치 (위조·변조)' }); continue; }
      ok.push({ id: g.id, time: g.time, payload, obj, v, msgIds: g.msgIds });
    } catch { bad.push({ ...g, why: '해독 실패' }); }
  }
  ok.sort((a, b) => b.time - a.time);
  return { items: ok, bad, raw };
}

/** 요청 하나의 지금 상태: ready(처리 가능) / used(이미 처리) / expired(만료). ctx 는 여러 건을 볼 때 재사용하는 캐시 */
export async function requestStatus(obj, v, ctx = {}) {
  const nowSec = Date.now() / 1000;
  if (obj.k === 'fwd') {
    ctx.fwdNonce ??= {};
    const from = obj.req.from.toLowerCase();
    ctx.fwdNonce[from] ??= await (await getContract('Forwarder')).nonces(obj.req.from);
    if (ctx.fwdNonce[from] > BigInt(obj.req.nonce)) return ['used', '이미 실행됐거나, 이 사람의 다른 요청이 먼저 실행돼 무효가 됐습니다'];
    if (ctx.fwdNonce[from] < BigInt(obj.req.nonce)) return ['wait', '같은 사람의 앞선 요청이 먼저 처리돼야 합니다 (순서 번호)'];
    return Number(obj.req.deadline) < nowSec ? ['expired', '유효기간이 지났습니다'] : ['ready', '아직 안 올림 — 지금 올릴 수 있음'];
  }
  if (obj.k === 'auth' || obj.k === 'buy') {
    const used = await (await getContract('Seogilwon')).authorizationState(obj.auth.from, obj.auth.nonce);
    if (used) return ['used', '이미 사용된 서명입니다 (한 번만 쓸 수 있음)'];
    return Number(obj.auth.validBefore) < nowSec ? ['expired', '유효기간이 지났습니다'] : ['ready', '아직 안 올림 — 지금 올릴 수 있음'];
  }
  if (obj.k === 'notice') {
    // 같은 신고서로 두 번 발행하지 않도록 발행 메모에 신고서 지문(서명 대상 해시)을 남긴다
    ctx.mints ??= await getEvents(await getContract('Seogilwon'), 'Mint');
    const done = ctx.mints.find(({ ev }) => ev.args.memo.includes(v.digest));
    return done ? ['used', '이 신고서로 이미 발행했습니다', done.log.transactionHash] : ['ready', '아직 발행하지 않은 신고서'];
  }
  if (obj.k === 'gas') {
    const bal = await chain.provider.getBalance(obj.gas.account);
    return bal >= E().parseEther('0.001') ? ['used', `이미 수수료용 ETH 가 있습니다 (${E().formatEther(bal).slice(0, 8)})`] : ['ready', 'ETH 가 없음 — 보내 줄 수 있음'];
  }
  return ['bad', '알 수 없는 요청'];
}
