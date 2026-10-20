// 블록체인 연결: 공개 노드 + 운영 열쇠(서버 지갑) + 컨트랙트
// 운영 열쇠는 '발행 담당(한도 있음)·정지·차단·내기판 관리자' 권한만 갖는다. 한도 충전·업그레이드·소유권은 발행자 MetaMask 에 있다.
import fs from 'node:fs';
import path from 'node:path';
import { ethers } from 'ethers';
import { WEB, loadAppConfig, readSecret } from './config.mjs';

globalThis.ethers = ethers; // web/js/core 의 공용 모듈(sigs.js·relaykit.js)이 쓰는 이름

export const cfg = loadAppConfig();
// cacheTimeout -1: 빠르게 이어지는 거래에서 nonce·잔액을 묵은 값으로 받지 않도록 캐시를 끈다
export const provider = new ethers.JsonRpcProvider(cfg.network.rpc, { chainId: cfg.network.chainId, name: cfg.network.name }, { staticNetwork: true, cacheTimeout: -1, pollingInterval: 4000 });

const pk = readSecret('operator.key');
export const operator = pk ? new ethers.Wallet(pk, provider) : null;

export const abiOf = (name) => JSON.parse(fs.readFileSync(path.join(WEB, 'contracts', `${name}.json`), 'utf8')).abi;
const ABI_NAME = { Seogilwon: 'SeogilwonV2', SeogilwonV1: 'SeogilwonV1' }; // 프록시는 V2 ABI 로 (V1 함수 포함)
export const contracts = {};
export const ifaces = {};
for (const [name, address] of Object.entries(cfg.contracts)) {
  if (name === 'SeogilwonV1') continue;
  const abi = abiOf(ABI_NAME[name] || name);
  contracts[name] = new ethers.Contract(address, abi, operator || provider);
  ifaces[name] = contracts[name].interface;
}
export const friendCoinAbi = abiOf('FriendCoin');

export const has = (name) => !!contracts[name];
export const addrEq = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
export const nameOfContract = (addr) => Object.entries(cfg.contracts).find(([, a]) => addrEq(a, addr))?.[0] || null;
