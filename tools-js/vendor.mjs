// 웹앱이 인터넷 CDN 없이도 동작하도록 ethers 라이브러리를 web/vendor 로 복사한다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dest = path.join(root, 'web', 'vendor');
fs.mkdirSync(dest, { recursive: true });
fs.copyFileSync(path.join(root, 'node_modules', 'ethers', 'dist', 'ethers.umd.min.js'), path.join(dest, 'ethers.umd.min.js'));
const v = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', 'ethers', 'package.json'), 'utf8')).version;
fs.writeFileSync(path.join(dest, 'VERSIONS.txt'), `ethers ${v} (MIT License)\n`);
console.log(`ethers ${v} → web/vendor/ethers.umd.min.js`);
