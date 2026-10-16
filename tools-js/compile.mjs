// contracts/*.sol 을 컴파일해 web/contracts/<이름>.json 으로 내보낸다.
// 산출물에는 ABI·바이트코드뿐 아니라 소스코드와 저장소 배치(storageLayout)까지 넣어,
// 웹앱에서 "체인에 올라간 코드가 이 소스에서 나온 것인지" 누구나 검증할 수 있게 한다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import solc from 'solc';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'contracts');
const outDir = path.join(root, 'web', 'contracts');

// cancun: 실험망 제네시스(config/network.json → genesis)에서 활성화한 최신 하드포크와 맞춘다
export const SETTINGS = {
  optimizer: { enabled: true, runs: 200 },
  evmVersion: 'cancun',
  outputSelection: {
    '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object',
                 'evm.deployedBytecode.immutableReferences', 'storageLayout', 'devdoc', 'userdoc'] },
  },
};

const sources = {};
for (const f of fs.readdirSync(srcDir).filter((f) => f.endsWith('.sol'))) {
  sources[f] = { content: fs.readFileSync(path.join(srcDir, f), 'utf8') };
}

const out = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources, settings: SETTINGS })));
const errors = (out.errors || []).filter((e) => e.severity === 'error');
for (const e of out.errors || []) console[e.severity === 'error' ? 'error' : 'warn'](e.formattedMessage);
if (errors.length) process.exit(1);

fs.mkdirSync(outDir, { recursive: true });
const index = [];
for (const [file, contracts] of Object.entries(out.contracts)) {
  for (const [name, c] of Object.entries(contracts)) {
    if (!c.evm.deployedBytecode.object) continue; // 인터페이스·추상 컨트랙트는 배포 대상이 아님
    const artifact = {
      contractName: name,
      sourceFile: file,
      source: sources[file].content,
      compiler: { version: solc.version(), settings: { optimizer: SETTINGS.optimizer, evmVersion: SETTINGS.evmVersion } },
      abi: c.abi,
      bytecode: '0x' + c.evm.bytecode.object,
      deployedBytecode: '0x' + c.evm.deployedBytecode.object,
      immutableReferences: c.evm.deployedBytecode.immutableReferences || {},
      storageLayout: c.storageLayout,
      devdoc: c.devdoc,
      userdoc: c.userdoc,
    };
    fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(artifact, null, 2));
    index.push({ name, sourceFile: file, bytes: c.evm.deployedBytecode.object.length / 2 });
    console.log(`  ✔ ${name.padEnd(22)} ${String(c.evm.deployedBytecode.object.length / 2).padStart(6)} bytes`);
  }
}
fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(index, null, 2));
console.log(`컴파일 완료 (solc ${solc.version()}) → web/contracts/`);
