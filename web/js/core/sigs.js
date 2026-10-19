// 서명(EIP-712) 양식 모음 — 웹앱과 Node 시험 스크립트가 함께 쓴다.
// 이용자가 MetaMask 에서 '서명'만 하면(수수료 0), 대납자가 그 서명을 블록체인에 올린다.
const E = () => globalThis.ethers;

export const FORWARDER_NAME = '청라더헤븐 대납 중계';

export const TYPES = {
  ForwardRequest: [
    { name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' },
    { name: 'gas', type: 'uint256' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }, { name: 'data', type: 'bytes' },
  ],
  TransferWithAuthorization: [
    { name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
  ],
  ReceiveWithAuthorization: [
    { name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
  ],
  Permit: [
    { name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' },
    { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' },
  ],
  // 블록체인에 올라가지 않는 '입금 신고서' (실제로는 은행 입금 후 발행사에 내는 신청서 역할)
  DepositNotice: [
    { name: 'account', type: 'address' }, { name: 'amount', type: 'uint256' }, { name: 'memo', type: 'string' }, { name: 'issuedAt', type: 'uint256' },
  ],
  // 블록체인에 올라가지 않는 '수수료용 ETH 요청' (직접 거래해 보고 싶은 참여자가 발행자에게)
  GasRequest: [
    { name: 'account', type: 'address' }, { name: 'issuedAt', type: 'uint256' },
  ],
};

export const forwarderDomain = (chainId, address) => ({ name: FORWARDER_NAME, version: '1', chainId, verifyingContract: address });
export const tokenDomain = (chainId, address, name = '서길원') => ({ name, version: '1', chainId, verifyingContract: address });

const now = () => Math.floor(Date.now() / 1000);
export const randomNonce = () => E().hexlify(E().randomBytes(32));

/** 대납 중계 요청 만들기 (서명 전) */
export async function buildForwardRequest({ forwarder, from, to, data, gas, ttlDays = 7 }) {
  const nonce = await forwarder.nonces(from);
  return { from, to, value: 0n, gas: BigInt(gas), nonce, deadline: BigInt(now() + ttlDays * 86400), data };
}

/** EIP-3009 송금·결제 서명 내용 (서명 전) */
export function buildAuthorization({ from, to, value, ttlDays = 7 }) {
  return { from, to, value: BigInt(value), validAfter: 0n, validBefore: BigInt(now() + ttlDays * 86400), nonce: randomNonce() };
}

export function splitSig(sig) {
  const s = E().Signature.from(sig);
  return { v: s.v, r: s.r, s: s.s };
}
