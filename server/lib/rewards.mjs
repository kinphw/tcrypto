// 참여 보상: 가입·출석·초대. 보상은 박형원이 아니라 은행 통장 원화로 준다 (발행은 언제나 충전을 거쳐서만).
import { db, now, today, settings } from './db.mjs';
import { transfer, TREASURY } from './bank.mjs';

const REWARD_KINDS = ['signup', 'checkin', 'streak', 'invite', 'inviter', 'grant'];
const startOfToday = () => Math.floor(Date.parse(`${today()}T00:00:00+09:00`) / 1000);
export const rewardedToday = () => db.prepare(`SELECT COALESCE(SUM(amount), 0) s FROM bank_tx WHERE from_acct = 'treasury' AND kind IN (${REWARD_KINDS.map(() => '?').join(',')}) AND at >= ?`).get(...REWARD_KINDS, startOfToday()).s;

/** 보상 지급. 하루 전체 상한을 넘으면 지급하지 않고 null (관리자 수동 지급 grant 는 상한 무시) */
export function reward(addr, amount, kind, memo, ref) {
  if (!(amount > 0)) return null;
  if (kind !== 'grant' && rewardedToday() + amount > settings().dailyRewardCap) return null;
  return transfer(TREASURY, addr, amount, kind, memo, ref);
}

export const getUser = (addr) => db.prepare('SELECT * FROM users WHERE addr = ?').get(addr.toLowerCase());
export const userByName = (name) => db.prepare('SELECT * FROM users WHERE name = ?').get(name);
export const joinsFromIpToday = (ip) => db.prepare('SELECT COUNT(*) n FROM users WHERE ip = ? AND joined_at >= ?').get(ip, startOfToday()).n;

/** 가입 등록 + 가입 보너스 + (초대 링크로 왔으면) 초대 보상. 이미 등록돼 있으면 아무것도 하지 않음 */
export function registerUser(addr, name, inviterName, ip) {
  addr = addr.toLowerCase();
  if (getUser(addr)) return { user: getUser(addr), paid: [] };
  const s = settings();
  db.prepare('INSERT INTO users(addr, name, invited_by, joined_at, ip) VALUES (?, ?, ?, ?, ?)').run(addr, name, null, now(), ip);
  const paid = [];
  const b = reward(addr, s.signupBonus, 'signup', '가입 축하금', `signup:${addr}`);
  if (b) paid.push({ kind: 'signup', amount: b.amount });
  const inviter = inviterName ? userByName(inviterName) : null;
  if (inviter && inviter.addr !== addr) {
    db.prepare('UPDATE users SET invited_by = ? WHERE addr = ?').run(inviter.addr, addr);
    const invitedToday = db.prepare("SELECT COUNT(*) n FROM bank_tx WHERE to_acct = ? AND kind = 'inviter' AND at >= ?").get(inviter.addr, startOfToday()).n;
    const r1 = reward(addr, s.inviteReward, 'invite', `${inviter.name} 님의 초대`, `invite:${addr}`);
    if (r1) paid.push({ kind: 'invite', amount: r1.amount });
    if (invitedToday < s.inviteDailyCap) reward(inviter.addr, s.inviteReward, 'inviter', `${name} 님 초대 보상`, `inviter:${addr}`);
  }
  return { user: getUser(addr), paid };
}

const yesterday = () => today(Date.now() - 86400e3);
export function checkinState(addr) {
  const u = getUser(addr);
  if (!u) return null;
  const done = u.last_checkin === today();
  const streak = done || u.last_checkin === yesterday() ? u.streak : 0;
  return { done, streak, next: settings().checkinReward, bonusAt: 7 - (streak % 7) };
}

/** 오늘 출석. 이어지면 연속 일수 +1, 7일마다 보너스 */
export function checkin(addr) {
  const u = getUser(addr);
  if (!u) throw new Error('먼저 가입해 주세요');
  const d = today();
  if (u.last_checkin === d) return { already: true, streak: u.streak, paid: [] };
  const streak = u.last_checkin === yesterday() ? u.streak + 1 : 1;
  db.prepare('UPDATE users SET last_checkin = ?, streak = ? WHERE addr = ?').run(d, streak, u.addr);
  const s = settings();
  const paid = [];
  const r = reward(u.addr, s.checkinReward, 'checkin', `${d} 출석`, `checkin:${u.addr}:${d}`);
  if (r) paid.push({ kind: 'checkin', amount: r.amount });
  if (streak % 7 === 0) {
    const b = reward(u.addr, s.streakBonus, 'streak', `${streak}일 연속 출석 보너스`, `streak:${u.addr}:${d}`);
    if (b) paid.push({ kind: 'streak', amount: b.amount });
  }
  return { already: false, streak, paid, capped: !r };
}
