// 개인키로 실험실 컨트랙트 4개를 배포하고 웹앱 설정 파일을 만든다 (로컬 시험망·자동화용).
// 실제 세폴리아 배포는 웹앱의 '발행자 · 감독 → 처음 설정' 화면에서 MetaMask 로 한다.
//   node tools-js/deploy.mjs <rpcUrl> <개인키파일(json: {pk})> <출력 설정 파일> [explorerUrl]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const art = (n) => JSON.parse(fs.readFileSync(path.join(root, 'web', 'contracts', `${n}.json`), 'utf8'));
const [rpcUrl, keyFile, outFile, explorer] = process.argv.slice(2);

const provider = new ethers.JsonRpcProvider(rpcUrl, undefined, { pollingInterval: 500 });
const pk = JSON.parse(fs.readFileSync(keyFile, 'utf8')).pk;
const signer = new ethers.NonceManager(new ethers.Wallet(pk, provider));
const net = await provider.getNetwork();
const startBlock = await provider.getBlockNumber();

async function deploy(name, ...args) {
  const a = art(name);
  const c = await new ethers.ContractFactory(a.abi, a.bytecode, signer).deploy(...args);
  await c.waitForDeployment();
  const addr = await c.getAddress();
  console.log(`  ✔ ${name.padEnd(12)} ${addr}`);
  return addr;
}

console.log(`배포: chainId ${net.chainId}, 발행자 ${signer.signer.address}`);
const Members = await deploy('Members');
const WonCoin = await deploy('WonCoin');
const Market = await deploy('Market', WonCoin);
const CoinFactory = await deploy('CoinFactory');

const base = JSON.parse(fs.readFileSync(path.join(root, 'web', 'app-config.json'), 'utf8'));
const cfg = {
  ...base,
  network: { ...base.network, chainId: Number(net.chainId), name: `로컬 시험망 ${net.chainId}`, rpc: rpcUrl, explorer: explorer || null,
    currency: { name: 'Test Ether', symbol: 'TETH', decimals: 18 }, faucets: [] },
  issuer: signer.signer.address,
  contracts: { Members, WonCoin, Market, CoinFactory },
  deployBlock: startBlock,
};
fs.writeFileSync(outFile, JSON.stringify(cfg, null, 2));
console.log(`설정 저장 → ${outFile}`);
