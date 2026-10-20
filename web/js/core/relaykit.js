// 서명 요청서(대납 봉투) 검증 — 브라우저와 운영 서버가 함께 쓴다 (globalThis.ethers 만 필요, 화면 코드 없음).
// 봉투 종류 (k)
//   fwd    : 대납 중계 요청 (명부·상점가·코인공장·내기판·쿠폰 시장의 일반 함수)
//   auth   : 박형원 서명 송금 (transferWithAuthorization)
//   redeem : 환매 — 운영 서버(발행 담당) 주소로 보내는 서명 송금. 서버가 받아서 소각하고 은행 통장에 원화로 돌려준다
//   buy    : 상점 서명 결제 (Market.buyWithAuthorization)
//   bet    : 내기 걸기 서명 결제 (Bets.betWithAuthorization)
//   cbuy   : 쿠폰 서명 결제 (Coupons.buyWithAuthorization)
//   notice : 입금(충전) 신청서 — 블록체인에 올라가지 않음
//   gas    : 수수료용 ETH 요청서 — 블록체인에 올라가지 않음
import { TYPES, forwarderDomain, tokenDomain } from './sigs.js';

const E = () => globalThis.ethers;

/** 문자열로 실려 온 숫자를 BigInt 로 (서명 대상 재구성용) */
export const big = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'string' && /^\d+$/.test(v) ? BigInt(v) : v]));

/** 봉투 → 서명 도메인·형식·내용·서명해야 할 사람. cfg = { network: { chainId }, contracts: { Forwarder, Seogilwon, ... } } */
export function relayParts(obj, cfg) {
  const chainId = cfg.network.chainId;
  const fwd = () => forwarderDomain(chainId, cfg.contracts.Forwarder);
  const token = () => tokenDomain(chainId, cfg.contracts.Seogilwon);
  if (obj.k === 'fwd') return { domain: fwd(), types: { ForwardRequest: TYPES.ForwardRequest }, message: big(obj.req), expected: obj.req.from };
  if (obj.k === 'auth' || obj.k === 'redeem') return { domain: token(), types: { TransferWithAuthorization: TYPES.TransferWithAuthorization }, message: big(obj.auth), expected: obj.auth.from };
  if (obj.k === 'buy' || obj.k === 'bet' || obj.k === 'cbuy') return { domain: token(), types: { ReceiveWithAuthorization: TYPES.ReceiveWithAuthorization }, message: big(obj.auth), expected: obj.auth.from };
  if (obj.k === 'notice') return { domain: token(), types: { DepositNotice: TYPES.DepositNotice }, message: big(obj.notice), expected: obj.notice.account };
  if (obj.k === 'gas') return { domain: token(), types: { GasRequest: TYPES.GasRequest }, message: big(obj.gas), expected: obj.gas.account };
  throw new Error('알 수 없는 요청 종류');
}

/** 서명자 복원 — 누가 내용을 바꿨다면 여기서 드러난다. digest = 서명 대상 지문 (같은 요청을 두 번 처리하지 않는 열쇠) */
export function verifyRelay(obj, cfg) {
  const p = relayParts(obj, cfg);
  const signer = E().verifyTypedData(p.domain, p.types, p.message, obj.sig);
  const digest = E().TypedDataEncoder.hash(p.domain, p.types, p.message);
  return { signer, ok: signer.toLowerCase() === p.expected.toLowerCase(), digest, ...p };
}

/** 봉투의 결제 받는 곳이 그 종류에 맞는 컨트랙트인지 (예: 내기 걸기 서명인데 받는 곳이 상점가면 거절) */
export function payeeOk(obj, cfg) {
  const to = obj.auth?.to?.toLowerCase();
  const is = (name) => to === cfg.contracts[name]?.toLowerCase();
  if (obj.k === 'buy') return is('Market');
  if (obj.k === 'bet') return is('Bets');
  if (obj.k === 'cbuy') return is('Coupons');
  return true;
}
