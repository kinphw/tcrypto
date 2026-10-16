// 실험실 컨트랙트들의 ABI 로 거래 입력값·이벤트 로그를 사람이 읽을 수 있게 해독한다.
import { artifact, artifactIndex, rpc } from './chain.js';
import { verifyRuntimeCode } from './verify.js';

const E = () => globalThis.ethers;
let all = null;
const known = new Map();

export async function allArtifacts() {
  if (!all) {
    all = (async () => {
      const idx = await artifactIndex();
      const arts = await Promise.all(idx.map((i) => artifact(i.name)));
      return arts.map((a) => ({ art: a, iface: new (E().Interface)(a.abi) }));
    })();
  }
  return all;
}

/** 주소의 코드를 공개 소스 컴파일 결과와 비교해 어떤 컨트랙트인지 알아낸다 (= 소스 검증) */
export async function identify(address) {
  if (!address) return null;
  const k = address.toLowerCase();
  if (known.has(k)) return known.get(k);
  const p = (async () => {
    const code = await rpc('eth_getCode', [address, 'latest']);
    if (!code || code === '0x') return null;
    for (const { art } of await allArtifacts()) if (verifyRuntimeCode(code, art).ok) return art.contractName;
    return null;
  })();
  known.set(k, p);
  const r = await p;
  if (!r) setTimeout(() => known.delete(k), 15000); // 나중에 컨트랙트가 생길 수 있으니 '없음'은 잠깐만 기억
  return r;
}

export async function decodeInput(to, data) {
  if (!data || data === '0x') return null;
  const arts = await allArtifacts();
  if (!to) {
    for (const { art, iface } of arts) {
      if (data.startsWith(art.bytecode)) {
        let args = [];
        try { if (iface.deploy.inputs.length) args = E().AbiCoder.defaultAbiCoder().decode(iface.deploy.inputs, '0x' + data.slice(art.bytecode.length)); } catch {}
        return { kind: 'deploy', contract: art.contractName, inputs: iface.deploy.inputs, args };
      }
    }
    return { kind: 'deploy', contract: null };
  }
  const name = await identify(to);
  const ordered = name ? [arts.find((a) => a.art.contractName === name), ...arts] : arts;
  for (const a of ordered.filter(Boolean)) {
    try {
      const p = a.iface.parseTransaction({ data });
      if (p) return { kind: 'call', contract: a.art.contractName, name: p.name, signature: p.signature, selector: p.selector, inputs: p.fragment.inputs, args: p.args };
    } catch {}
  }
  return { kind: 'unknown', selector: data.slice(0, 10) };
}

export async function decodeLog(log) {
  const name = await identify(log.address);
  const arts = await allArtifacts();
  const ordered = name ? [arts.find((a) => a.art.contractName === name), ...arts] : arts;
  for (const a of ordered.filter(Boolean)) {
    try {
      const p = a.iface.parseLog(log);
      if (p) return { contract: a.art.contractName, name: p.name, signature: p.signature, inputs: p.fragment.inputs, args: p.args };
    } catch {}
  }
  return null;
}

export function fmtArg(input, value) {
  if (value == null) return '';
  if (input.type === 'bytes' && E().dataLength(value) > 64) return `(${E().dataLength(value).toLocaleString()} 바이트 데이터)`;
  if (typeof value === 'bigint') return value.toLocaleString('ko-KR');
  if (Array.isArray(value)) return '[' + value.map((v) => String(v)).join(', ') + ']';
  return String(value);
}
