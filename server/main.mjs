// 청라더헤븐 운영 서버
//   - 화면: web/ (참여자 화면 /, 실험실 /lab/), 관리 페이지 /admin/
//   - API : 서명 요청 접수·가입·출석·충전·환매, 조회(피드·순위·내기·쿠폰·상점), 관리
//   - 뒤에서: 거래 대기열, 이벤트 색인, 내기 자동 정산, 준비금 대사
// 실행: node server/main.mjs   (pm2: ecosystem.config.cjs)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { WEB, ROOT, PORT, HOST, CONFIG_FILE } from './lib/config.mjs';
import { db, now, settings } from './lib/db.mjs';
import { cfg, contracts, operator, provider } from './lib/chain.mjs';
import { startQueue, getJob, jobView } from './lib/queue.mjs';
import { startIndexer, onIndexed, indexedTo, chainHead, evs } from './lib/indexer.mjs';
import { balance, history, reconcile } from './lib/bank.mjs';
import { checkin, checkinState, getUser } from './lib/rewards.mjs';
import { acceptRelay, acceptJoin, friendly } from './lib/intake.mjs';
import { settleTick } from './lib/settle.mjs';
import { names, feed, ranking, allBets, betView, allCoupons, couponView, allProducts } from './lib/views.mjs';
import * as admin from './lib/admin.mjs';
import { saveVault, loginVault, hasVault } from './lib/vault.mjs';

const ADMIN_DIR = path.join(ROOT, 'server', 'admin');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8' };
const MAX_BODY = 256 * 1024;

const lc = (a) => String(a || '').toLowerCase();
const isAddr = (a) => /^0x[0-9a-fA-F]{40}$/.test(a || '');

function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body, (k, v) => (typeof v === 'bigint' ? v.toString() : v));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(data);
}
const fail = (res, e) => send(res, e.status || 400, { error: friendly(e.message || String(e)) });

function clientIp(req) {
  const remote = req.socket.remoteAddress || '';
  const local = /^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(remote);
  return (local && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || remote;
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw Object.assign(new Error('요청이 너무 큽니다'), { status: 413 });
    chunks.push(c);
  }
  const s = Buffer.concat(chunks).toString('utf8');
  if (!s) return {};
  try { return JSON.parse(s); } catch { throw new Error('JSON 형식이 아닙니다'); }
}

// IP 당 쓰기 요청 제한 (분당 60)
const hits = new Map();
function limited(ip) {
  const t = Math.floor(Date.now() / 60000);
  const h = hits.get(ip);
  if (!h || h.t !== t) { hits.set(ip, { t, n: 1 }); return false; }
  return ++h.n > 60;
}
setInterval(() => hits.clear(), 10 * 60e3);

function serveFile(res, file, root) {
  const resolved = path.resolve(file);
  if (!resolved.startsWith(path.resolve(root) + path.sep) && resolved !== path.resolve(root)) return send(res, 404, { error: '없음' });
  fs.stat(resolved, (err, st) => {
    if (err) return send(res, 404, { error: '없음' });
    if (st.isDirectory()) return serveFile(res, path.join(resolved, 'index.html'), root);
    const ext = path.extname(resolved).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300' });
    fs.createReadStream(resolved).pipe(res);
  });
}

function publicConfig() {
  const s = settings();
  return {
    appName: cfg.appName, network: cfg.network, contracts: cfg.contracts, deployBlock: cfg.deployBlock, operator: operator?.address || null,
    rewards: { signupBonus: s.signupBonus, checkinReward: s.checkinReward, streakBonus: s.streakBonus, inviteReward: s.inviteReward, settleGraceMinutes: s.settleGraceMinutes, maxChargePerDay: s.maxChargePerDay },
  };
}

async function me(addr) {
  const a = lc(addr);
  const u = getUser(a);
  const sgw = await contracts.Seogilwon.balanceOf(addr).catch(() => null);
  const jobs = db.prepare("SELECT * FROM jobs WHERE addr = ? ORDER BY id DESC LIMIT 10").all(a).map(jobView);
  return {
    addr: a, user: u ? { name: u.name, joinedAt: u.joined_at, invitedBy: u.invited_by } : null,
    sgw: sgw == null ? null : Number(sgw), bank: balance(a), history: history(a, 30), checkin: checkinState(a),
    invited: db.prepare('SELECT COUNT(*) n FROM users WHERE invited_by = ?').get(a).n, jobs, vault: hasVault(a),
  };
}

async function api(req, res, url, ip) {
  const p = url.pathname.replace(/\/+$/, '');
  const q = url.searchParams;
  const viewer = isAddr(q.get('me')) ? lc(q.get('me')) : null;
  const M = req.method;

  if (M === 'POST' && limited(ip)) return send(res, 429, { error: '요청이 너무 잦습니다. 잠시 뒤 다시 해 주세요' });

  // ── 조회 ──
  if (M === 'GET') {
    if (p === '/api/config') return send(res, 200, publicConfig());
    if (p === '/api/status') return send(res, 200, { ok: true, head: chainHead(), indexed: indexedTo(), operator: !!operator });
    if (p === '/api/names') return send(res, 200, names());
    if (p.startsWith('/api/me/') && isAddr(p.slice(8))) return send(res, 200, await me(p.slice(8)));
    if (p.startsWith('/api/fwd-nonce/') && isAddr(p.slice(15))) {
      // 대납 중계 순서 번호: 체인의 번호 + 아직 처리 중인 이 사람의 중계 요청 수 (연달아 여러 개를 서명해도 겹치지 않게)
      const a = p.slice(15);
      const [n, pending] = [await contracts.Forwarder.nonces(a), db.prepare("SELECT COUNT(*) n FROM jobs WHERE addr = ? AND target = 'Forwarder' AND status IN ('queued', 'sent')").get(lc(a)).n];
      return send(res, 200, { nonce: (n + BigInt(pending)).toString() });
    }
    if (p.startsWith('/api/job/')) { const j = getJob(Number(p.slice(9))); return j ? send(res, 200, jobView(j)) : send(res, 404, { error: '없음' }); }
    if (p === '/api/feed') return send(res, 200, feed(Math.min(Number(q.get('limit')) || 40, 100), q.get('mine') ? viewer : null));
    if (p === '/api/rank') return send(res, 200, ranking());
    if (p === '/api/bets') return send(res, 200, allBets().map((b) => betView(b, viewer)).reverse());
    if (/^\/api\/bets\/\d+$/.test(p)) {
      const b = allBets().find((x) => x.id === Number(p.split('/')[3]));
      if (!b) return send(res, 404, { error: '없는 내기' });
      const nm = names();
      const people = Object.entries(b.stakes).map(([addr, st]) => ({ addr, name: nm[addr] || null, stakes: st })).sort((x, y) => y.stakes.reduce((a, c) => a + c, 0) - x.stakes.reduce((a, c) => a + c, 0));
      return send(res, 200, { ...betView(b, viewer), people });
    }
    if (p === '/api/coupons') return send(res, 200, allCoupons().map((c) => couponView(c, viewer)).reverse());
    if (p === '/api/shop') {
      const data = allProducts();
      if (viewer) { // 내 가게가 받은 주문
        const pr = new Map(data.products.map((x) => [x.id, x]));
        data.orders = evs('Market', 'Purchased', 'AND a2 = ?', viewer).reverse().slice(0, 30)
          .map((e) => ({ buyer: lc(e.args.buyer), name: pr.get(Number(e.args.productId))?.name, quantity: Number(e.args.quantity), total: Number(e.args.total), note: e.args.note, time: e.time }));
      }
      return send(res, 200, data);
    }
    const img = p.match(/^\/api\/img\/(product|coupon)\/(\d+)$/);
    if (img) {
      const r = db.prepare('SELECT mime, data FROM images WHERE kind = ? AND id = ?').get(img[1], Number(img[2]));
      if (!r) return send(res, 404, { error: '없음' });
      const mime = /^image\/(png|jpeg|gif|webp)$/.test(r.mime) ? r.mime : 'application/octet-stream';
      return send(res, 200, Buffer.from(r.data), { 'Content-Type': mime, 'Cache-Control': 'public, max-age=86400', 'Content-Security-Policy': "default-src 'none'" });
    }
    if (p === '/api/name-free') {
      const name = String(q.get('name') || '').trim();
      const used = !!db.prepare('SELECT 1 FROM users WHERE name = ?').get(name) || (await contracts.Members.addrOf(name)) !== '0x0000000000000000000000000000000000000000';
      return send(res, 200, { free: !!name && !used });
    }
  }

  // ── 참여자 요청 ──
  if (M === 'POST' && !p.startsWith('/api/admin/')) {
    const body = await readBody(req);
    if (p === '/api/relay') { const r = await acceptRelay(body.obj); return send(res, 200, { job: jobView(r.job), duplicate: r.duplicate }); }
    if (p === '/api/join') { const r = await acceptJoin(body.obj, body.invite, ip); return send(res, 200, { name: r.user?.name, paid: r.paid, job: jobView(r.job) }); }
    if (p === '/api/vault/save') return send(res, 200, saveVault(body));
    if (p === '/api/vault/login') return send(res, 200, loginVault(body, ip));
    if (p === '/api/checkin') {
      if (!isAddr(body.addr)) throw new Error('주소가 없습니다');
      return send(res, 200, checkin(body.addr));
    }
  }

  // ── 관리 ──
  if (p.startsWith('/api/admin/')) {
    const name = p.slice('/api/admin/'.length);
    if (M === 'POST' && name === 'login') return send(res, 200, admin.login(req, res, await readBody(req), ip));
    if (!admin.isAdmin(req)) return send(res, 401, { error: '로그인이 필요합니다' });
    if (M === 'POST' && req.headers['x-tc'] !== '1') return send(res, 403, { error: '잘못된 요청' }); // 다른 사이트에서 몰래 보내는 요청 차단
    if (M === 'POST' && name === 'logout') return send(res, 200, admin.logout(req, res));
    if (M === 'GET' && name === 'overview') return send(res, 200, await admin.overview());
    if (M === 'GET' && name === 'jobs') return send(res, 200, admin.jobs(q.get('status'), Number(q.get('limit')) || 100));
    if (M === 'GET' && name === 'users') return send(res, 200, admin.users());
    if (M === 'GET' && name === 'bank') return send(res, 200, admin.bankLog(Number(q.get('limit')) || 100));
    if (M === 'GET' && name === 'bets') return send(res, 200, allBets().map((b) => betView(b)).reverse());
    if (M === 'POST' && /^retry\/\d+$/.test(name)) return send(res, 200, admin.retry(Number(name.split('/')[1])));
    if (M === 'POST') { const r = await admin.action(name, await readBody(req)); return send(res, 200, r?.job ? { job: jobView(r.job) } : r); }
  }
  return send(res, 404, { error: '없는 API' });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  const ip = clientIp(req);
  let url;
  try { url = new URL(req.url, 'http://x'); } catch { return send(res, 400, { error: '잘못된 주소' }); }
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url, ip);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: '허용되지 않음' });
    if (url.pathname === '/app-config.json' || url.pathname === '/lab/app-config.json') return serveFile(res, CONFIG_FILE, path.dirname(CONFIG_FILE));
    // 실험실(예전 화면): /lab/ → web/lab.html, 나머지 /lab/... 는 web/... 를 그대로 (상대 경로가 그대로 맞도록)
    if (url.pathname === '/lab' ) { res.writeHead(301, { Location: '/lab/' }); return res.end(); }
    if (url.pathname === '/lab/' || url.pathname === '/lab/index.html') return serveFile(res, path.join(WEB, 'lab.html'), WEB);
    if (url.pathname.startsWith('/lab/')) return serveFile(res, path.join(WEB, decodeURIComponent(url.pathname.slice(5))), WEB);
    if (url.pathname === '/admin') { res.writeHead(301, { Location: '/admin/' }); return res.end(); }
    if (url.pathname.startsWith('/admin/')) {
      res.setHeader('X-Frame-Options', 'DENY');
      return serveFile(res, path.join(ADMIN_DIR, decodeURIComponent(url.pathname.slice(7))), ADMIN_DIR);
    }
    return serveFile(res, path.join(WEB, decodeURIComponent(url.pathname)), WEB);
  } catch (e) {
    if (!e.status) console.warn(`[api] ${req.method} ${url.pathname}: ${e.message}`);
    return fail(res, e);
  }
});

// ── 뒤에서 도는 일 ──
startQueue();
startIndexer();
onIndexed(() => { try { settleTick(); } catch (e) { console.warn('[settle]', e.message); } });
reconcile().then((r) => console.log(`[bank] 준비금 ${r.reserve.toLocaleString()}원 / 총발행 ${r.supply.toLocaleString()} sgw (소각 대기 ${r.pendingBurn}) → ${r.ok ? '일치' : '불일치!'}`)).catch((e) => console.warn('[bank] 대사 실패:', e.message));
setInterval(() => reconcile().catch(() => {}), 5 * 60e3);

server.listen(PORT, HOST, () => {
  console.log(`청라더헤븐 서버 http://${HOST}:${PORT}  (${cfg.network.name}, 설정 ${path.relative(ROOT, CONFIG_FILE)})`);
  console.log(operator ? `운영 지갑 ${operator.address}` : '운영 지갑 없음 — node server/setup.mjs 로 만드세요');
});
