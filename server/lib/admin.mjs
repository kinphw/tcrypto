// 관리 페이지 API: 비밀번호 로그인(scrypt) → 세션 쿠키. 로그인 실패가 이어지면 그 IP 를 잠시 막는다.
import crypto from 'node:crypto';
import { db, now, settings, setSettings, kvGet, kvSet } from './db.mjs';
import { ethers } from 'ethers';
import { readSecret } from './config.mjs';
import { cfg, provider, contracts, operator } from './chain.mjs';
import { enqueue, queueStats, jobView, kick } from './queue.mjs';
import { balance, RESERVE, TREASURY, lastReconcile, reconcile } from './bank.mjs';
import { reward, rewardedToday, getUser, userByName } from './rewards.mjs';
import { allBets, sgwBalances } from './views.mjs';
import { indexedTo, chainHead } from './indexer.mjs';

const SESSION_HOURS = 12;
const sessions = new Map(); // token → 만료 시각
const fails = new Map(); // ip → { n, until }

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `scrypt$${salt}$${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
}
function checkPassword(pw) {
  const stored = readSecret('admin.pass');
  if (!stored) return false;
  const [, salt, hash] = stored.split('$');
  const got = crypto.scryptSync(String(pw), salt, 64);
  const want = Buffer.from(hash, 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

const cookieOf = (req, name) => (req.headers.cookie || '').split(/;\s*/).map((c) => c.split('=')).find(([k]) => k === name)?.[1];
export function isAdmin(req) {
  const t = cookieOf(req, 'tca');
  const exp = t && sessions.get(t);
  if (!exp) return false;
  if (exp < Date.now()) { sessions.delete(t); return false; }
  return true;
}

function blockedIp(ip) {
  const f = fails.get(ip);
  if (f && f.until > Date.now()) throw Object.assign(new Error('로그인 시도가 너무 많습니다. 15분 뒤 다시 해 주세요'), { status: 429 });
}
function missIp(ip) {
  const f = fails.get(ip);
  const n = (f?.n || 0) + 1;
  fails.set(ip, { n: n >= 5 ? 0 : n, until: n >= 5 ? Date.now() + 15 * 60e3 : 0 });
}
function openSession(res) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + SESSION_HOURS * 3600e3);
  res.setHeader('Set-Cookie', `tca=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_HOURS * 3600}`);
}

export function login(req, res, body, ip) {
  blockedIp(ip);
  if (!checkPassword(body.password || '')) {
    missIp(ip);
    throw Object.assign(new Error('비밀번호가 맞지 않습니다'), { status: 401 });
  }
  fails.delete(ip);
  openSession(res);
  return { ok: true };
}

// ───── 관리자 지갑: 앱에 평소처럼 로그인한 계정으로 관리 페이지 들어가기 ─────
// 등록된 지갑 주소가 서버가 낸 1회용 문장에 서명하면 관리자 세션을 연다 (비밀번호 로그인은 비상용으로 그대로).
// 발행자 MetaMask(app-config 의 issuer)는 처음부터 관리자 지갑이다.
export function adminWallets() {
  const list = JSON.parse(kvGet('admin.wallets', '[]'));
  if (cfg.issuer && !list.includes(cfg.issuer.toLowerCase())) list.unshift(cfg.issuer.toLowerCase());
  return list;
}
export const isAdminWallet = (a) => !!a && adminWallets().includes(String(a).toLowerCase());
export function setAdminWallet(addr, on) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr || '')) throw new Error('주소가 아닙니다');
  const a = addr.toLowerCase();
  if (!on && cfg.issuer && a === cfg.issuer.toLowerCase()) throw new Error('발행자 지갑은 뺄 수 없습니다');
  const list = JSON.parse(kvGet('admin.wallets', '[]')).filter((x) => x !== a);
  if (on) list.push(a);
  kvSet('admin.wallets', JSON.stringify(list));
  return { wallets: adminWallets() };
}

const challenges = new Map(); // 1회용 문장 → 만료 시각
export function challenge(addr) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr || '')) throw new Error('주소가 아닙니다');
  const message = `수원더헤븐 관리자 로그인\n주소: ${ethers.getAddress(addr)}\n시각: ${now()}\n1회용: ${crypto.randomBytes(12).toString('hex')}`;
  challenges.set(message, Date.now() + 5 * 60e3);
  for (const [m, t] of challenges) if (t < Date.now()) challenges.delete(m);
  return { message };
}
export function walletLogin(req, res, { addr, message, sig }, ip) {
  blockedIp(ip);
  const exp = challenges.get(message);
  challenges.delete(message); // 한 번 쓰면 끝
  let signer = null;
  try { signer = ethers.verifyMessage(String(message || ''), String(sig || '')); } catch {}
  const ok = exp && exp > Date.now() && signer && signer.toLowerCase() === String(addr || '').toLowerCase()
    && String(message).includes(ethers.getAddress(addr)) && isAdminWallet(addr);
  if (!ok) {
    missIp(ip);
    throw Object.assign(new Error('관리자 지갑 서명이 아니에요'), { status: 401 });
  }
  fails.delete(ip);
  openSession(res);
  return { ok: true };
}
export function logout(req, res) {
  sessions.delete(cookieOf(req, 'tca'));
  res.setHeader('Set-Cookie', 'tca=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0');
  return { ok: true };
}

const who = async (q) => {
  q = String(q || '').trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(q)) return q;
  const u = userByName(q);
  if (u) return u.addr;
  const a = await contracts.Members.addrOf(q);
  if (a && !/^0x0+$/.test(a)) return a;
  throw new Error(`'${q}' 를 찾을 수 없습니다`);
};

export async function overview() {
  const t = contracts.Seogilwon;
  const op = operator?.address;
  const [eth, isMinter, allowance, paused, pauser, blacklister, masterMinter, owner, betsAdmin] = await Promise.all([
    op ? provider.getBalance(op) : 0n, op ? t.isMinter(op) : false, op ? t.minterAllowance(op) : 0n, t.paused(), t.pauser(), t.blacklister(), t.masterMinter(), t.owner(),
    contracts.Bets ? contracts.Bets.admin() : null,
  ]);
  const rec = await reconcile().catch(() => lastReconcile());
  const eq = (a) => !!op && !!a && a.toLowerCase() === op.toLowerCase();
  return {
    operator: op, eth: eth.toString(), isMinter, allowance: allowance.toString(), paused,
    roles: { pauser: eq(pauser), blacklister: eq(blacklister), betsAdmin: eq(betsAdmin), masterMinter, owner },
    reconcile: rec, queue: queueStats(), rewardedToday: rewardedToday(), settings: settings(),
    users: db.prepare('SELECT COUNT(*) n FROM users').get().n,
    bank: { reserve: balance(RESERVE), treasury: balance(TREASURY), deposits: db.prepare("SELECT COALESCE(SUM(balance), 0) s FROM bank_accounts WHERE id NOT IN ('reserve', 'treasury')").get().s },
    index: { at: indexedTo(), head: chainHead() },
  };
}

export const jobs = (status, limit = 100) => (status
  ? db.prepare('SELECT * FROM jobs WHERE status = ? ORDER BY id DESC LIMIT ?').all(status, limit)
  : db.prepare('SELECT * FROM jobs ORDER BY id DESC LIMIT ?').all(limit)).map((j) => ({ ...jobView(j), addr: j.addr, target: j.target, method: j.method }));

export function users() {
  const sgw = sgwBalances();
  return db.prepare('SELECT * FROM users ORDER BY joined_at DESC').all().map((u) => ({
    addr: u.addr, name: u.name, joinedAt: u.joined_at, ip: u.ip, streak: u.streak, lastCheckin: u.last_checkin,
    invitedBy: u.invited_by, bank: balance(u.addr), sgw: sgw[u.addr] || 0,
  }));
}

export const bankLog = (limit = 100) => db.prepare('SELECT * FROM bank_tx ORDER BY id DESC LIMIT ?').all(limit);

export function retry(id) {
  const j = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  if (!j || j.status !== 'failed') throw new Error('실패한 작업만 다시 할 수 있습니다');
  if (['mint', 'redeem'].includes(j.kind)) throw new Error('충전·환매는 은행 처리가 함께 묶여 있어 다시 하기를 지원하지 않습니다');
  db.prepare("UPDATE jobs SET status = 'queued', error = NULL, tx = NULL, nonce = NULL WHERE id = ?").run(id);
  kick();
  return { ok: true };
}

export async function action(name, body) {
  if (name === 'settings') return setSettings(body || {});
  if (name === 'grant') {
    const addr = await who(body.who);
    if (!getUser(addr)) throw new Error('가입한 사람에게만 줄 수 있습니다');
    const amt = Math.floor(Number(body.amount));
    if (!(amt > 0)) throw new Error('금액을 확인하세요');
    return reward(addr.toLowerCase(), amt, 'grant', body.memo || '관리자 지급', `grant:${now()}:${addr}:${Math.random()}`);
  }
  if (name === 'bet-cancel') return enqueue({ kind: 'admin', label: `내기 #${body.id} 관리자 취소`, target: 'Bets', method: 'cancel', args: [Number(body.id)] });
  if (name === 'bet-resolve') {
    const b = allBets().find((x) => x.id === Number(body.id));
    if (!b) throw new Error('없는 내기입니다');
    return enqueue({ kind: 'admin', label: `내기 #${b.id} 결과 정정 → ${b.options[Number(body.option)]}`, target: 'Bets', method: 'adminResolve', args: [b.id, Number(body.option)] });
  }
  if (name === 'blacklist') {
    const addr = await who(body.who);
    const reason = String(body.reason || '관리자 조치').slice(0, 190);
    return enqueue({ kind: 'admin', label: `${body.on ? '차단' : '차단 해제'} ${addr}`, target: 'Seogilwon', method: body.on ? 'blacklist' : 'unBlacklist', args: [addr, reason] });
  }
  if (name === 'pause') {
    const reason = String(body.reason || (body.on ? '긴급 점검' : '정상화')).slice(0, 190);
    return enqueue({ kind: 'admin', label: body.on ? '전체 정지' : '정지 해제', target: 'Seogilwon', method: body.on ? 'pause' : 'unpause', args: [reason] });
  }
  // 준비금 공시(attestReserve)는 발행 총괄 권한이라 서버가 아니라 발행자 MetaMask 로 한다 (/lab 발행자 화면)
  throw new Error('알 수 없는 관리 작업');
}
