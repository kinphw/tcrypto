# 확장 가이드

웹사이트는 빌드 과정이 없어서 파일을 추가하는 것만으로 늘어납니다.

## 새 화면 추가

1. `web\js\modules\내화면.js`
   ```js
   import { chain, getContract, getEvents, writable, track } from '../core/chain.js';
   import { html, render, $, won } from '../core/ui.js';

   export default {
     title: '내 화면',
     async render(view, params, app) {
       const coin = await getContract('WonCoin');
       render(view, html`<h1>총 발행량 ${won(await coin.totalSupply())}</h1>`);
     },
   };
   ```
2. `web\js\modules\index.js` 의 `MODULES` 에 한 줄 추가
   ```js
   { id: 'mine', title: '내 화면', icon: '◇', load: () => import('./mine.js') },
   ```

### 쓸 수 있는 도구

| 위치 | 함수 | 용도 |
|---|---|---|
| `core/chain.js` | `getContract(이름[, 주소])` | 읽기용 컨트랙트 (공개 노드 경유) |
| | `writable(c)` + `track(c.함수(...), '라벨')` | MetaMask 서명 → 전송 → 블록 포함 대기 |
| | `getEvents(c, '이벤트명', [indexed 필터])` | 배포 블록부터 이벤트 모으기 |
| | `rpc(method, params)` | 노드에 직접 질의 (하단 ‘노드와의 대화’에 기록) |
| | `app.onBlock(fn)`, `app.onWallet(fn)` | 화면 전환 시 자동 해제되는 구독 |
| `core/verify.js` | `verifyBlockHash`, `verifyTransaction`, `verifyRuntimeCode` | 노드를 믿지 않고 직접 재계산 |
| `core/abi.js` | `decodeInput`, `decodeLog`, `identify` | ABI 해독, 코드로 컨트랙트 식별 |
| `core/ui.js` | `html```, `kv`, `explain`, `verifyBox`, `stat`, `won`, `scan`, `busy`, `toast` | 화면 조립 (`scan('tx', 해시)` = 이더스캔 링크) |

`explain(제목, 본문, { kind: 'sup' })` 은 노란색 ‘감독 관점’ 상자입니다.

## 새 컨트랙트 추가

1. `contracts\새것.sol` 작성 → `npm run compile`
2. 배포: 웹앱 ‘처음 설정’(`web\js\modules\issuer.js` 의 `renderSetup`) 목록에 추가하거나, 별도 화면에서 `ContractFactory` 로 배포
3. 주소를 `web\app-config.json` 의 `contracts` 에 추가 → `getContract('새것')` 으로 사용
4. 거래 해부·주소 화면은 `web\contracts\index.json` 의 모든 ABI 를 자동으로 써서 해독·소스 검증합니다.

아이디어: 에스크로(배송 확인 후 지급), 다중서명 발행 승인, 이자 주는 예금, 간단한 거래소(AMM), 투표.

## 다른 네트워크로 옮기기

`web\app-config.json` 의 `network` 만 바꾸면 됩니다 (예: Base Sepolia, Holesky).
`rpc` 는 브라우저에서 호출 가능한(CORS 허용) 공개 노드여야 합니다.
