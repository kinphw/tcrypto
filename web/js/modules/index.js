// ── 메뉴 등록부 ──
// 새 화면을 추가하려면 modules/ 에 파일을 만들고 여기에 한 줄 추가하면 된다 (docs/EXTENDING.md).
// nav: false 인 화면은 메뉴에 안 보이고 링크로만 들어간다.
export const MODULES = [
  { id: 'home', group: '거래', title: '내 지갑', icon: 'WLT', load: () => import('./home.js') },
  { id: 'send', group: '거래', title: '송금', icon: 'SND', load: () => import('./send.js') },
  { id: 'shop', group: '거래', title: '상점가', icon: 'MKT', load: () => import('./shop.js') },
  { id: 'coins', group: '거래', title: '내 코인 발행', icon: 'MNT', load: () => import('./coins.js') },
  { id: 'issuer', group: '발행 · 감독', title: '발행자 · 감독', icon: 'ISS', load: () => import('./issuer.js') },
  { id: 'explore', group: '장부', title: '들여다보기', icon: 'EXP', load: () => import('./explore.js') },
  { id: 'tx', title: '거래 해부', nav: false, load: () => import('./tx.js') },
  { id: 'blocks', title: '블록', nav: false, load: () => import('./blocks.js') },
  { id: 'address', title: '주소', nav: false, load: () => import('./address.js') },
];
