// 운영 서버 설정: 명령줄 → 네트워크·컨트랙트 주소(app-config.json) · 비밀(.secrets) · 데이터 폴더
//   node server/main.mjs [--config web/app-config.json] [--port 4300] [--data server/data] [--secrets server/.secrets]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const WEB = path.join(ROOT, 'web');

const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : process.env[`TCRYPTO_${name.toUpperCase()}`] || def;
};

export const CONFIG_FILE = path.resolve(ROOT, arg('config', 'web/app-config.json'));
export const PORT = Number(arg('port', '4300'));
export const HOST = arg('host', '127.0.0.1'); // Apache 가 앞에서 받아 넘겨 준다 → 바깥에 직접 열지 않음
export const DATA_DIR = path.resolve(ROOT, arg('data', 'server/data'));
export const SECRETS_DIR = path.resolve(ROOT, arg('secrets', 'server/.secrets'));
export const RPC = arg('rpc', '');

export function loadAppConfig() {
  const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  if (RPC) cfg.network.rpc = RPC;
  return cfg;
}

export const secretPath = (name) => path.join(SECRETS_DIR, name);
export function readSecret(name) {
  try { return fs.readFileSync(secretPath(name), 'utf8').trim(); } catch { return null; }
}
export function writeSecret(name, value) {
  fs.mkdirSync(SECRETS_DIR, { recursive: true });
  fs.writeFileSync(secretPath(name), value, { mode: 0o600 });
}

// 관리 페이지에서 바꿀 수 있는 운영 값의 기본값 (바꾼 값은 DB settings 표에 저장)
export const DEFAULT_SETTINGS = {
  signupBonus: 100000, // 가입 보너스 (원, 은행 통장으로)
  checkinReward: 10000, // 매일 출석
  streakBonus: 30000, // 7일 연속 출석 보너스
  inviteReward: 50000, // 초대한 사람·초대받은 사람 각각
  inviteDailyCap: 5, // 초대자 한 명이 하루에 보상받는 최대 인원
  dailyRewardCap: 5000000, // 하루 전체 보상 상한 (넘으면 그날 보상 중지)
  joinsPerIpPerDay: 10, // 같은 IP 에서 하루 가입 수 (계정 부풀리기 방지)
  maxChargePerDay: 1000000, // 한 사람이 하루에 충전(발행) 가능한 최대 원화
  settleGraceMinutes: 60, // 내기 결과 뒤 자동 정산까지 기다리는 시간 (그 사이 관리자가 정정 가능)
};
