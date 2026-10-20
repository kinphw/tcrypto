// 개인키로 수원더헤븐 컨트랙트를 배포하고 웹앱 설정 파일을 만든다 (로컬 시험망·자동화용).
// 실제 세폴리아 배포는 웹앱의 '발행자 · 감독 → 처음 설정' 화면에서 MetaMask 로 한다.
//   node tools-js/deploy.mjs <rpcUrl> <개인키파일(json: {pk})> <출력 설정 파일> [explorerUrl]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';
import { deployAll } from './deploy-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [rpcUrl, keyFile, outFile, explorer] = process.argv.slice(2);
const provider = new ethers.JsonRpcProvider(rpcUrl, undefined, { pollingInterval: 500 });
const signer = new ethers.NonceManager(new ethers.Wallet(JSON.parse(fs.readFileSync(keyFile, 'utf8')).pk, provider));
const net = await provider.getNetwork();
const startBlock = await provider.getBlockNumber();
console.log(`배포: chainId ${net.chainId}, 발행자 ${signer.signer.address}`);
const contracts = await deployAll(signer);
const base = JSON.parse(fs.readFileSync(path.join(root, 'web', 'app-config.json'), 'utf8'));
const cfg = {
  ...base,
  network: { ...base.network, chainId: Number(net.chainId), name: `로컬 시험망 ${net.chainId}`, rpc: rpcUrl, explorer: explorer || null,
    currency: { name: 'Test Ether', symbol: 'TETH', decimals: 18 }, faucets: [] },
  issuer: signer.signer.address,
  contracts,
  deployBlock: startBlock,
};
fs.writeFileSync(outFile, JSON.stringify(cfg, null, 2));
console.log(`설정 저장 → ${outFile}`);
