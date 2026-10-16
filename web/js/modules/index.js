// ── 메뉴 등록부 ──
// 새 화면을 추가하려면 modules/ 에 파일을 만들고 여기에 한 줄 추가하면 된다 (docs/EXTENDING.md).
// nav: false 인 화면은 메뉴에 안 보이고 링크로만 들어간다.
export const MODULES = [
  { id: 'home', title: '내 지갑', icon: '◐', load: () => import('./home.js') },
  { id: 'send', title: '송금', icon: '⇄', load: () => import('./send.js') },
  { id: 'shop', title: '상점가', icon: '▤', load: () => import('./shop.js') },
  { id: 'coins', title: '내 코인 발행', icon: '◈', load: () => import('./coins.js') },
  { id: 'issuer', title: '발행자 · 감독', icon: '₩', load: () => import('./issuer.js') },
  { id: 'explore', title: '들여다보기', icon: '◎', load: () => import('./explore.js') },
  { id: 'tx', title: '거래 해부', nav: false, load: () => import('./tx.js') },
  { id: 'blocks', title: '블록', nav: false, load: () => import('./blocks.js') },
  { id: 'address', title: '주소', nav: false, load: () => import('./address.js') },
];
