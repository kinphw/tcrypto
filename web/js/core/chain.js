// 블록체인 연결의 중심.
//  - 읽기: 공개 노드(app-config.json 의 rpc)에 직접 묻는다. MetaMask 가 없어도 누구나 볼 수 있다.
//  - 쓰기: MetaMask 가 서명해서 보낸다. 웹앱은 개인키를 전혀 만지지 않는다.
// 읽기와 쓰기가 서로 다른 경로(공개 노드 vs MetaMask 의 노드)라서, 같은 장부를 서로 다른 곳에서 확인하는 셈이다.
import { toast, setLabeler, errMsg } from './ui.js';

const E = () => globalThis.ethers;

export const chain = {
  cfg: null,
  provider: null,
  head: 0,
  headBlock: null,
  members: {},   // 주소(소문자) → 닉네임
  ready: false,  // 컨트랙트 배포 여부
};

// ───────── RPC 기록 (하단 '노드와의 대화') ─────────
const rpcListeners = new Set();
export const onRpc = (fn) => (rpcListeners.add(fn), () => rpcListeners.delete(fn));
const pending = new Map();
function onDebug(info) {
  if (info.action === 'sendRpcPayload') {
    for (const p of [].concat(info.payload)) pending.set(p.id, { t: performance.now(), payload: p });
  } else if (info.action === 'receiveRpcResult' || info.action === 'receiveRpcError') {
    for (const r of [].concat(info.result || info.error || [])) {
      const req = pending.get(r?.id);
      if (!req) continue;
      pending.delete(r.id);
      rpcListeners.forEach((fn) => fn({ method: req.payload.method, params: req.payload.params, result: r.result, error: r.error, ms: Math.round(performance.now() - req.t) }));
    }
  }
}

// ───────── 시작 ─────────
const DEPLOY_KEY = 'tcrypto.deployment';

export async function initChain() {
  const qs = new URLSearchParams(location.search);
  const cfgFile = qs.get('config') || 'app-config.json';
  chain.cfg = await fetch(cfgFile, { cache: 'no-store' }).then((r) => {
    if (!r.ok) throw new Error(`${cfgFile} 를 읽지 못했습니다`);
    return r.json();
  });
  // 창조자가 방금 배포했지만 설정 파일에 아직 반영되지 않은 경우: 이 브라우저에 저장된 배포 정보를 사용
  if (!chain.cfg.contracts) {
    try {
      const d = JSON.parse(localStorage.getItem(DEPLOY_KEY) || 'null');
      if (d && d.chainId === chain.cfg.network.chainId) Object.assign(chain.cfg, { issuer: d.issuer, contracts: d.contracts, deployBlock: d.deployBlock });
    } catch {}
  }
  chain.ready = !!chain.cfg.contracts;
  const net = chain.cfg.network;
  chain.provider = new (E().JsonRpcProvider)(qs.get('rpc') || net.rpc, { chainId: net.chainId, name: net.name }, {
    staticNetwork: true, batchMaxCount: 1, pollingInterval: 4000,
  });
  chain.provider.on('debug', onDebug);
  setLabeler(labelOf);
  await refreshHead();
  if (chain.ready) await loadMembers().catch((e) => console.warn('명부 로드 실패', e));
}

export function saveLocalDeployment(d) {
  try { localStorage.setItem(DEPLOY_KEY, JSON.stringify(d)); } catch {}
}

export const rpc = (method, params = []) => chain.provider.send(method, params);
export const explorer = (kind, id) => (chain.cfg.network.explorer ? `${chain.cfg.network.explorer}/${kind}/${id}` : null);

// ───────── 새 블록 감시 ─────────
const blockListeners = new Set();
export const onBlock = (fn) => (blockListeners.add(fn), () => blockListeners.delete(fn));
const statusListeners = new Set();
export const onStatus = (fn) => (statusListeners.add(fn), () => statusListeners.delete(fn));

async function refreshHead() {
  const n = Number(await rpc('eth_blockNumber'));
  if (n !== chain.head || !chain.headBlock) {
    chain.head = n;
    chain.headBlock = await rpc('eth_getBlockByNumber', [E().toQuantity(n), false]);
    blockListeners.forEach((fn) => { try { fn(chain.headBlock); } catch (e) { console.error(e); } });
  }
}
let failures = 0;
export function startPolling() {
  setInterval(async () => {
    try {
      await refreshHead();
      if (failures) statusListeners.forEach((fn) => fn(true));
      failures = 0;
    } catch (e) {
      if (++failures === 2) statusListeners.forEach((fn) => fn(false, e));
    }
  }, 4000);
}

// ───────── 컨트랙트 ─────────
const artifacts = {};
export function artifact(name) {
  if (!artifacts[name]) artifacts[name] = fetch(`contracts/${name}.json`).then((r) => r.json());
  return artifacts[name];
}
export const artifactIndex = () => fetch('contracts/index.json').then((r) => r.json());

const contracts = {};
/** 읽기용 컨트랙트. name: Members | WonCoin | Market | CoinFactory, 또는 (주소, 산출물이름) */
export async function getContract(name, address) {
  const key = `${name}@${address || ''}`;
  if (!contracts[key]) {
    const a = await artifact(name);
    const addr = address || chain.cfg.contracts?.[name];
    if (!addr) throw new Error(`${name} 컨트랙트가 아직 배포되지 않았습니다`);
    contracts[key] = new (E().Contract)(addr, a.abi, chain.provider);
  }
  return contracts[key];
}

// ───────── 이벤트 로그 (배포 블록부터, 구간을 나눠 조회하고 메모리에 누적) ─────────
const logCache = new Map();
export async function getEvents(contract, eventName, extraTopics = []) {
  const address = await contract.getAddress();
  const topic0 = eventName ? contract.interface.getEvent(eventName).topicHash : null;
  const topics = topic0 ? [topic0, ...extraTopics] : [];
  const key = `${address}|${JSON.stringify(topics)}`;
  const c = logCache.get(key) || { upTo: (chain.cfg.deployBlock ?? 0) - 1, items: [] };
  const to = Number(await rpc('eth_blockNumber'));
  const STEP = 20000;
  for (let a = c.upTo + 1; a <= to; a += STEP) {
    const b = Math.min(to, a + STEP - 1);
    const logs = await rpc('eth_getLogs', [{ address, topics: topics.length ? topics : undefined, fromBlock: E().toQuantity(a), toBlock: E().toQuantity(b) }]);
    for (const log of logs) {
      try { c.items.push({ log, ev: contract.interface.parseLog(log) }); } catch {}
    }
    c.upTo = b;
  }
  logCache.set(key, c);
  return c.items;
}

/** 블록 번호 → 시각 (여러 번 묻지 않도록 저장) */
const tsCache = new Map();
export async function blockTime(n) {
  n = Number(n);
  if (!tsCache.has(n)) tsCache.set(n, rpc('eth_getBlockByNumber', [E().toQuantity(n), false]).then((b) => Number(b.timestamp)));
  return tsCache.get(n);
}

// ───────── 닉네임 명부 ─────────
export async function loadMembers() {
  const m = await getContract('Members');
  const [addrs, names] = await m.all();
  chain.members = {};
  addrs.forEach((a, i) => { chain.members[a.toLowerCase()] = names[i]; });
  return chain.members;
}

export function labelOf(addr) {
  if (!addr || !chain.cfg) return null;
  const a = addr.toLowerCase();
  const c = chain.cfg.contracts || {};
  for (const [k, v] of Object.entries(c)) {
    if (v && v.toLowerCase() === a) return { WonCoin: '원화코인 컨트랙트', Market: '상점가 컨트랙트', Members: '명부 컨트랙트', CoinFactory: '코인공장 컨트랙트' }[k];
  }
  const nick = chain.members[a];
  if (chain.cfg.issuer && a === chain.cfg.issuer.toLowerCase()) return nick ? `${nick} (발행자)` : '발행자';
  if (nick) return nick;
  if (wallet.address && a === wallet.address.toLowerCase()) return '나';
  return null;
}

// ───────── MetaMask ─────────
export const wallet = { address: null, signer: null, chainOk: false, installed: false };
const walletListeners = new Set();
export const onWallet = (fn) => (walletListeners.add(fn), () => walletListeners.delete(fn));
const emitWallet = () => walletListeners.forEach((fn) => { try { fn(wallet); } catch (e) { console.error(e); } });

export const chainIdHex = () => E().toQuantity(chain.cfg.network.chainId);

async function syncWallet() {
  const eth = window.ethereum;
  wallet.installed = !!eth;
  if (!eth) return;
  const [accts, cid] = await Promise.all([eth.request({ method: 'eth_accounts' }), eth.request({ method: 'eth_chainId' })]);
  wallet.address = accts[0] ? E().getAddress(accts[0]) : null;
  wallet.chainOk = Number(cid) === chain.cfg.network.chainId;
  wallet.signer = wallet.address && wallet.chainOk ? await new (E().BrowserProvider)(eth).getSigner(wallet.address) : null;
}

export async function initWallet() {
  const eth = window.ethereum;
  wallet.installed = !!eth;
  if (!eth) return;
  await syncWallet().catch(() => {});
  eth.on?.('accountsChanged', () => syncWallet().then(emitWallet));
  eth.on?.('chainChanged', () => syncWallet().then(emitWallet));
}

export async function connectWallet() {
  const eth = window.ethereum;
  if (!eth) throw new Error('MetaMask 가 없습니다. 크롬에 MetaMask 를 설치한 뒤 새로고침하세요.');
  await eth.request({ method: 'eth_requestAccounts' });
  await switchNetwork();
  await syncWallet();
  emitWallet();
}

export async function switchNetwork() {
  const eth = window.ethereum;
  const net = chain.cfg.network;
  try {
    await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainIdHex() }] });
  } catch (e) {
    const code = e.code ?? e?.data?.originalError?.code;
    if (code !== 4902) throw e;
    await eth.request({
      method: 'wallet_addEthereumChain',
      params: [{ chainId: chainIdHex(), chainName: net.name, nativeCurrency: net.currency, rpcUrls: [net.rpc], blockExplorerUrls: net.explorer ? [net.explorer] : undefined }],
    });
  }
}

/** MetaMask 화면에 원화코인(또는 친구 코인)을 표시하도록 등록 */
export async function watchToken(address, symbol) {
  return window.ethereum.request({ method: 'wallet_watchAsset', params: { type: 'ERC20', options: { address, symbol: symbol.slice(0, 11), decimals: 0 } } });
}

export function requireWallet() {
  if (!wallet.installed) throw new Error('MetaMask 가 필요합니다. 홈 화면의 안내를 보세요.');
  if (!wallet.address) throw new Error('먼저 오른쪽 위 [MetaMask 연결]을 눌러 주세요');
  if (!wallet.chainOk) throw new Error(`MetaMask 의 네트워크를 ${chain.cfg.network.name} 로 바꿔 주세요`);
  return wallet.signer;
}

export async function writable(contract) {
  return contract.connect(requireWallet());
}

/** 거래 전송 → 알림 → 블록 포함까지 기다림 (공개 노드에 영수증을 직접 묻는다) */
export async function track(txPromise, label = '거래') {
  const tx = await txPromise;
  toast(`${label}: MetaMask 가 서명해 보냈습니다. 블록에 담길 때까지 기다리는 중… (보통 10~20초)`);
  const r = await waitReceipt(tx.hash);
  if (r.status === 1) toast(`${label} 완료 — 블록 #${r.blockNumber}`, 'ok');
  else toast(`${label} 실패 — 컨트랙트가 거절했습니다 (블록 #${r.blockNumber})`, 'bad');
  return r;
}

export async function waitReceipt(hash, timeoutMs = 300000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const r = await rpc('eth_getTransactionReceipt', [hash]).catch(() => null);
    if (r) return { ...r, hash, status: Number(r.status), blockNumber: Number(r.blockNumber) };
    await new Promise((res) => setTimeout(res, 2500));
  }
  throw new Error('5분 동안 블록에 담기지 않았습니다. MetaMask 활동 탭에서 상태를 확인하세요.');
}

export { errMsg };
