# 청라더헤븐 — 원화 스테이블코인 서길원(sgw) 거래소

**링크: <https://tcrypto.kro.kr/>** (친구용 화면, MetaMask 없이 바로 시작) · 실험실(블록체인 들여다보기): <https://tcrypto.kro.kr/lab/> · 관리: <https://tcrypto.kro.kr/admin/>
예전 주소 kinphw.github.io/tcrypto 는 새 주소로 넘겨줍니다.

## 2판: 운영 서버 + 가상 은행 + 내기판·쿠폰

```
tcrypto.kro.kr ─ Apache(SSL) ─→ Node 서버 127.0.0.1:4300 (pm2 'tcrypto')
                                 ├ /        친구용 화면 (web/index.html + web/app/)   홈·내기·쿠폰·상점·나
                                 ├ /lab/    예전 화면 그대로 (web/lab.html + web/js/)   발행자 MetaMask 작업·들여다보기
                                 ├ /admin/  관리 페이지 (server/admin/, 비밀번호)
                                 └ /api/    서명 요청 접수 → 거래 대기열 → 블록체인 (수수료는 운영 지갑)
```

- **가상 은행**: 서버 안의 원화 장부(블록체인 밖 = 진짜 은행 자리). 가입 10만·출석 1만·초대 5만 원이 **통장으로** 들어온다.
  서길원은 언제나 **충전**(통장 → 준비금 → 발행)으로만 생기고 **환매**(소각 → 준비금 → 통장)로 돌아간다 → **준비금 = 총발행량**이 늘 맞는다(관리 페이지 대사).
  현금은 오가지 않는다(내기판이 있으므로 진짜 원화를 받으면 도박·무허가 지급수단 문제).
- **운영 지갑**(`server/.secrets/operator.key`): 발행 담당(한도 있음)·정지·차단·내기판 관리자. 한도 충전·업그레이드·소유권은 발행자 MetaMask 에 그대로.
- **내기판**(`contracts/Bets.sol`): 누구나 열고 만든 사람이 결과. 판돈은 이긴 쪽에 건 금액 비율로, 결과 1시간 뒤 서버가 자동 정산(그 사이 관리자 정정 가능).
- **쿠폰**(`contracts/Coupons.sol`): 누구나 만들어 팔고·선물하고·쓰기(만든 사람에게 사용 기록).
- 친구들은 **브라우저 지갑**(복구 문구 12단어를 그 기기에 보관)으로 바로 시작. MetaMask 연결은 선택.

### 운영
```powershell
pm2 start ecosystem.config.cjs; pm2 save   # 서버 켜기 (pm2 logs tcrypto)
node server/setup.mjs key                  # 운영 지갑 주소 보기 (없으면 만듦)
node server/setup.mjs password             # 관리 페이지 비밀번호 정하기
node server/setup.mjs deploy-games         # 내기판·쿠폰 배포 (운영 지갑 ETH 필요) → app-config.json
# 공개: C:\projects\apache_config\enable_tcrypto.ps1 (관리자 PowerShell, DNS → 80 → 인증서 → 443)
```

### 로컬 시험 (hardhat)
```powershell
npx hardhat --config hardhat.config.cjs node        # 8545
node tools-js/stable-test.mjs http://127.0.0.1:8545 <hardhat 0번 개인키>
node tools-js/games-test.mjs  http://127.0.0.1:8545 <같은 키>
node server/setup.mjs local <같은 키> --config web/app-config.local.json --secrets server/.secrets-local --data server/data-local
node server/main.mjs --config web/app-config.local.json --secrets server/.secrets-local --data server/data-local --port 4301
node tools-js/server-test.mjs http://127.0.0.1:4301 <로컬 관리 비밀번호>
```

---

아래는 1판(브라우저 + MetaMask만으로 운영하던 때) 설명입니다. 실험실(/lab)은 지금도 이대로 동작합니다.

이더리움 공식 시험망 **세폴리아(Sepolia)** 위에서 돌아가는 작은 경제 실험실입니다.
실제 원화 스테이블코인(USDC·USDT 구조)을 최대한 비슷하게 흉내 내고, 블록체인에 실제로 어떻게 기록되는지 원본 데이터까지 들여다볼 수 있게 만들었습니다.

- **당신(창조자)** = 서길원 **발행사** (소유자·발행 총괄·정지 담당·블랙리스트 담당·프록시 관리자)
- **친구들** = 링크로 들어와서 MetaMask 지갑으로 참여. **ETH 가 없어도 됩니다** (서명만 하고 수수료는 대납)
- 참여 순서: **지갑 만들기 → 입금 신청 → 사용 → 환매 신청** (실제 스테이블코인의 입금 → 발행 → 유통 → 환매 → 소각)
- 할 수 있는 것: 송금, 상점 열기·상품 올리기·구매, 내 코인 만들기, 모든 거래 들여다보기

모든 기록은 이 웹사이트가 아니라 **이더리움(세폴리아) 블록체인**에 남습니다.
같은 잔액과 거래를 **이 웹사이트 · MetaMask · 이더스캔** 세 곳에서 따로 확인할 수 있습니다.
웹사이트는 서버 없는 정적 페이지입니다. 버튼을 누르면 휴대폰·PC 안의 JS 가 MetaMask 에 서명을 요청하고, MetaMask 가 블록체인에 직접 보냅니다.

---

## 실제 스테이블코인과 같은 구조

| 실제 (USDC 등) | 청라더헤븐 |
|---|---|
| 은행에 달러 입금 → 발행사가 확인 후 발행 | **입금 신청서**에 서명(블록체인 밖, 수수료 0) → 링크를 발행자에게 → 발행자가 확인 후 `mint` |
| 발행사로 코인 보내면 달러 상환 후 소각 | 발행자 주소로 서길원 보내기 = 환매 신청 → 발행자가 원화 지급(밖) 후 `burn` |
| 발행 담당자마다 한도 (minter allowance) | `configureMinter(담당자, 한도)` — 한도 넘게는 발행 불가 |
| 블랙리스트·전체 정지·차단 자금 소각 | `blacklist` / `pause` / `destroyBlackFunds` (모두 사유가 공개 기록) |
| 프록시로 규칙 교체 (업그레이드) | EIP-1967 프록시. V1 → V2 교체 시 잔액 유지, V2 에 `clawback`(강제 회수) 추가 |
| 수수료 없는 송금 (EIP-3009, EIP-2612) | `transferWithAuthorization`, `permit`, 상점 `buyWithAuthorization` |
| 지갑 회사 서버가 수수료 대납 (릴레이어) | ERC-2771 대납 중계기. 서명이 **공개 요청함**(ntfy.sh 공개 우편함)에 자동으로 들어가고, 발행자가 요청함에서 수수료 내고 올림. 우편함은 누구나 열람 가능, 안 되면 링크로 예비 전달 |

---

## 창조자가 할 일 (처음 한 번)

### 1. MetaMask 설치
1. PC 크롬: <https://metamask.io/download/> → 확장 프로그램 추가 → **새 지갑 만들기**. 휴대폰: MetaMask 앱 설치
2. 비밀 복구 구문 12단어를 **종이에 적어 보관** (이 지갑이 서길원 발행 권한을 갖습니다. 누구에게도, Claude 에게도 보여주지 마세요)
3. 네트워크 선택 → **테스트 네트워크 보기** 켜기 → **Sepolia** 선택

### 2. 시험용 ETH 받기 (수수료용, 무료)
대납을 해 주는 사람은 발행자이므로 발행자만 ETH 가 있으면 됩니다.
- <https://cloud.google.com/application/web3/faucet/ethereum/sepolia> (구글 계정 로그인 → MetaMask 주소 붙여넣기)
- 0.05 ETH 면 대납 수백 건이 가능합니다.

### 3. 거래소 열기 (컨트랙트 배포)
1. 사이트를 열고 **MetaMask 연결**
2. **발행자 · 감독** → 배포될 주소 6개를 미리 계산해 보여줍니다 → **MetaMask 로 배포 시작** → MetaMask 승인 **7번** (배포 6 + 발행 담당 지정 1)
3. 끝나면 Claude 에게 **“배포 끝났어”** → 다른 사람들도 쓸 수 있게 설정을 반영합니다

### 4. 친구 초대와 운영
1. 링크와 **참여 안내서**(<https://kinphw.github.io/tcrypto/guide.html>)를 보냅니다
2. 메뉴 **요청함 → 자동 처리기**: 이 기기에 만들기 → ETH 0.02 충전 → 발행 권한(한도 1,000,000 sgw) 주기 → 켜기. 이후 사이트를 열어 두면 친구들의 송금·상점·구매 요청을 자동으로 올리고, 입금 신청을 자동으로 발행합니다(건당 상한 초과분만 직접 처리)
3. 자동 처리기를 끄면 요청함에서 **올려 주기 / 입금 확인 → 발행** 버튼으로 직접 처리할 수 있습니다 (같은 신청서로 두 번 발행되지 않습니다)
4. **발행자 · 감독 → 환매 처리**에서 친구가 보낸 서길원을 소각

---

## 화면 구성

| 메뉴 | 내용 |
|---|---|
| 내 지갑 | 잔액, 입금 신청, 환매 신청, 내 입출금 (수수료는 언제나 발행사가 냄) |
| 송금 | 주소로 서길원·친구 코인 보내기 |
| 요청함 | 서명된 요청이 모이는 공개 우편함 (누구나 열람) + 자동 처리기(발행사 서버 역할: 한도 있는 발행 담당 키로 자동 대납·발행) |
| 상점가 | 상품 구경·구매, 내 상점 열기, 상품 올리기(사진 포함), 받은 주문 |
| 내 코인 발행 | 누구나 자기 코인 만들기, 추가 발행 |
| 발행자 · 감독 | 역할 구조, 입금 신청 처리, 발행·상환 소각, 발행 한도, 블랙리스트·정지, 준비금 공시, V2 업그레이드·강제 회수, 역할 넘기기, 보유 현황 대사, 감사 로그 |
| 들여다보기 | 전체 기록, 거래 해부(RLP 원본·서명 복원·대납자 vs 서명자·장부 칸 전/후), 블록 해부, 주소(계정 4칸·저장공간·머클 증명·프록시 슬롯·기계어) |

---

## 폴더 구조 (개발용)

```
contracts\    Seogilwon(V1·V2), SgwProxy, Forwarder, Members, Market, CoinFactory
web\          웹사이트 (빌드 과정 없는 순수 HTML/JS) — 이 폴더가 GitHub Pages 로 공개됨
  app-config.json   네트워크와 배포된 컨트랙트 주소
  contracts\        컴파일 결과 (ABI·기계어·소스·저장공간 배치)
tools-js\     컴파일·배포 탐지·시험 도구
docs\         참여자 안내서, 확장 가이드
```

```powershell
npm run compile                          # contracts\*.sol → web\contracts\*.json
npm run serve                            # http://localhost:8080 에서 미리보기
npm run find-deployment -- 0x발행자주소   # 배포된 컨트랙트 주소를 찾아 app-config.json 에 기록
node tools-js/stable-test.mjs            # 로컬 anvil(8545)에서 전체 기능 시험
```

새 기능을 붙이는 방법은 [docs/EXTENDING.md](docs/EXTENDING.md).

## 알아둘 점
- 세폴리아는 **전 세계에 공개된** 블록체인입니다. 송금 메모·상품 사진·발행 기록을 누구나 볼 수 있습니다. 실명·연락처는 넣지 마세요.
- 코인과 상품은 모두 가상이며 가치가 없습니다. 외부 판매·홍보를 하지 않습니다.
- 서길원은 프록시 구조라 규칙(구현)을 바꿀 수 있습니다. 바로 그 권한(프록시 관리자)이 이 구조에서 가장 강력한 권한입니다. 명부·상점가·코인공장은 업그레이드할 수 없습니다.
