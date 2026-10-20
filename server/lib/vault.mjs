// 계정 보관함: 다른 기기에서 '닉네임 + 비밀번호'로 들어올 수 있게, 참여자 지갑의 암호문을 맡아 둔다.
//  - 암호문(vault)은 참여자 브라우저가 자기 비밀번호로 잠근 것이다. 서버는 비밀번호도 열쇠도 모르고 풀 수 없다.
//  - 로그인 확인값(auth)은 비밀번호에서 따로 뽑은 값(scrypt, 닉네임을 소금으로). 서버는 그 해시만 저장한다.
//  - 틀린 시도가 이어지면 그 닉네임·그 IP 를 잠시 막는다 (암호문을 아무나 받아 가 비밀번호를 맞혀 보지 못하게).
import crypto from 'node:crypto';
import { ethers } from 'ethers';
import { db, now } from './db.mjs';

db.exec(`CREATE TABLE IF NOT EXISTS vaults (addr TEXT PRIMARY KEY, auth TEXT NOT NULL, vault TEXT NOT NULL, updated_at INTEGER)`);

export const vaultMessage = (addr, vault, at) => `청라더헤븐 계정 보관\n주소: ${addr}\n암호문 지문: ${ethers.keccak256(ethers.toUtf8Bytes(vault))}\n시각: ${at}`;
const h = (s) => crypto.createHash('sha256').update(String(s)).digest();

/** 맡기기·바꾸기: 지갑 주인의 서명이 있어야 한다 (남이 내 보관함을 바꿔치기하지 못하게) */
export function saveVault({ addr, name, auth, vault, at, sig }) {
  const user = db.prepare('SELECT * FROM users WHERE addr = ?').get(String(addr || '').toLowerCase());
  if (!user || user.name !== name) throw new Error('가입한 닉네임과 지갑이 맞지 않습니다');
  if (!/^0x[0-9a-f]{64}$/.test(auth || '')) throw new Error('잘못된 확인값');
  if (typeof vault !== 'string' || vault.length > 6000) throw new Error('잘못된 보관 자료');
  if (Math.abs(now() - Number(at)) > 600) throw new Error('오래된 요청입니다. 다시 해 주세요');
  let parsed;
  try { parsed = JSON.parse(vault); } catch { throw new Error('잘못된 보관 자료'); }
  if (String(parsed.address || '').replace(/^0x/, '').toLowerCase() !== user.addr.slice(2)) throw new Error('보관 자료의 주소가 다릅니다');
  if (ethers.verifyMessage(vaultMessage(ethers.getAddress(addr), vault, at), sig).toLowerCase() !== user.addr) throw new Error('지갑 서명이 맞지 않습니다');
  db.prepare(`INSERT INTO vaults(addr, auth, vault, updated_at) VALUES (?, ?, ?, ?)
              ON CONFLICT(addr) DO UPDATE SET auth = excluded.auth, vault = excluded.vault, updated_at = excluded.updated_at`)
    .run(user.addr, h(auth).toString('hex'), vault, now());
  return { ok: true };
}

export const hasVault = (addr) => !!db.prepare('SELECT 1 FROM vaults WHERE addr = ?').get(String(addr || '').toLowerCase());

const fails = new Map(); // 'n:닉네임' · 'i:IP' → { n, until }
const LIMIT = { n: 5, i: 20 };
function blocked(key) { const f = fails.get(key); return f && f.until > Date.now(); }
function miss(key, max) {
  const f = fails.get(key) || { n: 0, until: 0 };
  f.n++;
  if (f.n >= max) { f.n = 0; f.until = Date.now() + 15 * 60e3; }
  fails.set(key, f);
}
setInterval(() => { const t = Date.now(); for (const [k, f] of fails) if (f.until < t && f.n === 0) fails.delete(k); }, 30 * 60e3);

export function loginVault({ name, auth }, ip) {
  name = String(name || '').trim();
  if (blocked(`n:${name}`) || blocked(`i:${ip}`)) throw Object.assign(new Error('틀린 시도가 많아 잠시 막혔어요. 15분 뒤 다시 해 주세요'), { status: 429 });
  const row = db.prepare('SELECT v.* FROM vaults v JOIN users u ON u.addr = v.addr WHERE u.name = ?').get(name);
  const ok = row && /^0x[0-9a-f]{64}$/.test(auth || '') && crypto.timingSafeEqual(h(auth), Buffer.from(row.auth, 'hex'));
  if (!ok) {
    miss(`n:${name}`, LIMIT.n); miss(`i:${ip}`, LIMIT.i);
    throw Object.assign(new Error('닉네임이나 비밀번호가 맞지 않아요'), { status: 401 });
  }
  fails.delete(`n:${name}`);
  return { addr: row.addr, vault: row.vault };
}
