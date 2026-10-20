// 블록체인 보기 (앱 안의 탐색기): 주소 하나, 거래 하나를 사람이 읽을 수 있게 풀어서 돌려준다.
//  - 주소: 개인 지갑 / 스마트 계정(EIP-7702 위임) / 컨트랙트 구분, ETH·박형원 잔액, 이 주소가 나온 기록
//  - 거래: 보낸 사람(수수료 낸 쪽)과 서명한 사람(실제 요청자), 호출한 함수(대납이면 안쪽 요청까지), 결과, 이벤트, 원본
import { ethers } from 'ethers';
import { db } from './db.mjs';
import { cfg, provider, contracts, ifaces, friendCoinAbi, nameOfContract, operator, addrEq } from './chain.mjs';
import { names } from './views.mjs';

const coinIface = new ethers.Interface(friendCoinAbi);
const lc = (a) => String(a || '').toLowerCase();
const plain = (v) => (typeof v === 'bigint' ? v.toString() : Array.isArray(v) ? v.map(plain) : v && typeof v === 'object' && v.constructor?.name === 'Result' ? plain(v.toArray()) : v);
const argsOf = (frag, vals) => Object.fromEntries(frag.inputs.map((inp, i) => [inp.name || `arg${i}`, plain(vals[i])]));

const friendCoins = () => new Set(db.prepare("SELECT args FROM events WHERE contract = 'CoinFactory' AND name = 'CoinCreated'").all().map((r) => lc(JSON.parse(r.args).coin)));
function ifaceFor(addr) {
  const n = nameOfContract(addr);
  if (n && ifaces[n]) return { name: n, iface: ifaces[n] };
  if (friendCoins().has(lc(addr))) return { name: 'FriendCoin', iface: coinIface };
  return null;
}

export async function addressView(addr) {
  const a = ethers.getAddress(addr);
  const [code, eth, nonce, sgw] = await Promise.all([
    provider.getCode(a), provider.getBalance(a), provider.getTransactionCount(a), contracts.Seogilwon.balanceOf(a).catch(() => 0n),
  ]);
  const contract = nameOfContract(a) || (friendCoins().has(lc(a)) ? 'FriendCoin' : null);
  let kind = 'person';
  let delegate = null;
  if (code !== '0x') {
    if (code.startsWith('0xef0100') && code.length === 48) { kind = 'smart'; delegate = ethers.getAddress('0x' + code.slice(8)); }
    else kind = 'contract';
  }
  const role = addrEq(a, operator?.address) ? 'operator' : addrEq(a, cfg.issuer) ? 'issuer' : null;
  // 이 주소가 나온 기록: 주소가 이벤트 인자에 들어 있거나, 이 주소(컨트랙트)가 낸 이벤트
  const rows = contract && contract !== 'FriendCoin'
    ? db.prepare('SELECT * FROM events WHERE contract = ? OR a1 = ? OR a2 = ? ORDER BY block DESC, idx DESC LIMIT 60').all(contract, lc(a), lc(a))
    : db.prepare('SELECT * FROM events WHERE a1 = ? OR a2 = ? ORDER BY block DESC, idx DESC LIMIT 60').all(lc(a), lc(a));
  return {
    address: a, name: names()[lc(a)] || null, kind, delegate, contract, role,
    eth: eth.toString(), sgw: sgw.toString(), nonce, codeSize: code === '0x' ? 0 : (code.length - 2) / 2,
    events: rows.map((r) => ({ block: r.block, time: r.time, tx: r.tx, contract: r.contract, event: r.name, args: JSON.parse(r.args) })),
  };
}

function decodeCall(to, data) {
  const f = to ? ifaceFor(to) : null;
  if (!f || !data || data === '0x') return null;
  try {
    const p = f.iface.parseTransaction({ data });
    return p ? { contract: f.name, method: p.name, signature: p.signature, args: argsOf(p.fragment, p.args) } : null;
  } catch { return null; }
}

export async function txView(hash) {
  const [tx, rc] = await Promise.all([provider.getTransaction(hash), provider.getTransactionReceipt(hash)]);
  if (!tx) throw Object.assign(new Error('그런 거래가 없어요'), { status: 404 });
  const block = rc ? await provider.getBlock(rc.blockNumber) : null;
  const call = decodeCall(tx.to, tx.data);
  // 대납 중계: 겉은 운영 지갑이 Forwarder.execute 를 부른 것, 안쪽은 서명한 사람이 원한 실제 호출
  let inner = null;
  if (call?.contract === 'Forwarder' && call.method === 'execute') {
    const req = call.args.req || call.args.arg0;
    const r = Array.isArray(req) ? { from: req[0], to: req[1], value: req[2], gas: req[3], nonce: req[4], deadline: req[5], data: req[6] } : req;
    inner = { signer: r.from, to: r.to, nonce: r.nonce, deadline: r.deadline, call: decodeCall(r.to, r.data) };
  }
  // 서명 결제(EIP-3009): 인자 안의 from 이 서명한 사람
  const authSigner = call && /WithAuthorization$/.test(call.method) ? (call.args.from || call.args.buyer) : null;
  const logs = (rc?.logs || []).map((l) => {
    const f = ifaceFor(l.address);
    let ev = null;
    try { ev = f?.iface.parseLog(l); } catch {}
    return { index: l.index, address: l.address, contract: f?.name || null, event: ev?.name || null, args: ev ? argsOf(ev.fragment, ev.args) : null, topics: ev ? undefined : l.topics, data: ev ? undefined : l.data };
  });
  for (const l of logs) if (l.args && 'image' in l.args && typeof l.args.image === 'string' && l.args.image.length > 66) l.args.image = `(사진 ${(l.args.image.length - 2) / 2}바이트)`;
  if (call?.args?.image && call.args.image.length > 66) call.args.image = `(사진 ${(call.args.image.length - 2) / 2}바이트)`;
  if (inner?.call?.args?.image && inner.call.args.image.length > 66) inner.call.args.image = `(사진 ${(inner.call.args.image.length - 2) / 2}바이트)`;
  return {
    hash: tx.hash, status: rc ? rc.status : null, block: rc?.blockNumber ?? null, time: block?.timestamp ?? null,
    from: tx.from, to: tx.to, nonce: tx.nonce, type: tx.type, value: tx.value.toString(),
    gasLimit: tx.gasLimit.toString(), gasUsed: rc?.gasUsed.toString() ?? null, gasPrice: (rc?.gasPrice ?? tx.gasPrice ?? 0n).toString(),
    fee: rc ? (rc.gasUsed * (rc.gasPrice ?? 0n)).toString() : null,
    relayed: !!inner || !!authSigner, signer: inner?.signer || authSigner || tx.from,
    call, inner, logs,
    raw: { input: tx.data.length > 4000 ? `${tx.data.slice(0, 4000)}… (${(tx.data.length - 2) / 2}바이트)` : tx.data, signature: { v: tx.signature?.v, r: tx.signature?.r, s: tx.signature?.s } },
  };
}
