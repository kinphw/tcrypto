// 수원더헤븐 컨트랙트 배포 순서 (Node 도구용. 웹앱 '처음 설정' 화면도 같은 순서를 따른다)
//  1 Forwarder        대납 중계
//  2 SeogilwonV1      박형원 구현(규칙) 1판
//  3 SgwProxy         박형원 고정 주소 (initialize 를 함께 실행)
//  4 Members          명부
//  5 Market           상점가 (박형원 주소 필요)
//  6 CoinFactory      코인공장
//  + configureMinter  발행 총괄이 자신을 발행 담당으로 지정하고 한도 부여
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const art = (n) => JSON.parse(fs.readFileSync(path.join(root, 'web', 'contracts', `${n}.json`), 'utf8'));
export const TOKEN = { name: '박형원', symbol: 'phw', currency: 'KRW', decimals: 0 };
export const INITIAL_MINTER_ALLOWANCE = 100_000_000n;

export async function deployAll(signer, log = console.log) {
  const me = await signer.getAddress();
  const deploy = async (name, ...args) => {
    const a = art(name);
    const c = await new ethers.ContractFactory(a.abi, a.bytecode, signer).deploy(...args);
    await c.waitForDeployment();
    const addr = await c.getAddress();
    log(`  ✔ ${name.padEnd(12)} ${addr}`);
    return addr;
  };
  const Forwarder = await deploy('Forwarder');
  const SeogilwonV1 = await deploy('SeogilwonV1');
  const init = new ethers.Interface(art('SeogilwonV1').abi).encodeFunctionData('initialize', [TOKEN.name, TOKEN.symbol, TOKEN.currency, TOKEN.decimals, me]);
  const Seogilwon = await deploy('SgwProxy', SeogilwonV1, me, init);
  const Members = await deploy('Members', Forwarder);
  const Market = await deploy('Market', Seogilwon, Forwarder);
  const CoinFactory = await deploy('CoinFactory', Forwarder);
  const token = new ethers.Contract(Seogilwon, art('SeogilwonV1').abi, signer);
  await (await token.configureMinter(me, INITIAL_MINTER_ALLOWANCE)).wait();
  log(`  ✔ configureMinter (발행 한도 ${INITIAL_MINTER_ALLOWANCE.toLocaleString()} phw)`);
  return { Forwarder, Seogilwon, SeogilwonV1, Members, Market, CoinFactory };
}

// 2판 놀이 컨트랙트: 내기판·쿠폰 시장. 박형원·중계기는 이미 있는 것을 쓰고, 내기판 관리자는 발행자.
export async function deployGames(signer, { Seogilwon, Forwarder, admin }, log = console.log) {
  const deploy = async (name, ...args) => {
    const a = art(name);
    const c = await new ethers.ContractFactory(a.abi, a.bytecode, signer).deploy(...args);
    await c.waitForDeployment();
    const addr = await c.getAddress();
    log(`  ✔ ${name.padEnd(12)} ${addr}`);
    return addr;
  };
  const Bets = await deploy('Bets', Seogilwon, Forwarder, admin);
  const Coupons = await deploy('Coupons', Seogilwon, Forwarder);
  return { Bets, Coupons };
}
