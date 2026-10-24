# MiniArena · Game QA Lab

게임 QA 자동화 실습용 작은 Three.js 아레나입니다. 규칙 계산은 화면과 분리되어 있습니다.

## 실행

Node.js 22.12 이상을 사용합니다. 프로젝트 루트에서 아래 순서로 실행합니다.

1. 최초 설치: `npm.cmd install` (macOS/Linux는 `npm install`)
2. 게임 실행: `npm.cmd run dev`
3. 표시된 주소 <http://127.0.0.1:5173/>를 브라우저에서 엽니다.

이 작업에서 패키지는 이미 설치했습니다. 다음 실행은 2번부터 하면 됩니다.

- WASD: 이동. 키를 모두 놓으면 가장 가까운 적을 자동 공격합니다.
- Pause / Esc: 일시정지. Resume / Esc: 재개.
- Next Stage: 클리어 후 다음 단계. 3단계 클리어 후에는 Retry만 가능합니다.
- Retry: 어떤 상태에서도 1단계의 최초 상태로 되돌립니다.
- 다른 탭/창으로 이동하면 일시정지하고, 돌아와도 자동 재개하지 않습니다.

## 검증

```powershell
npm.cmd test
npm.cmd run test:smoke
npm.cmd run test:movement
npm.cmd run test:p0
npm.cmd run test:adapter
npm.cmd run test:browser
npm.cmd run build
```

`test:smoke`는 가장 작은 시작 검사 1개입니다. 일반 게임 페이지의 HTTP 응답, canvas 표시와 실제 WebGL 픽셀 렌더링, 시작 과정의 console.error 및 미처리 pageerror 부재를 확인합니다. 오류 수집은 페이지를 열기 전부터 시작하며, 게임 상태를 주입하거나 테스트 Hook으로 게임을 대신 진행하지 않습니다.

`test:movement`는 일반 실시간 게임에서 Playwright로 W키를 1,000ms 누릅니다. 입력 전후 `window.__THREE_GAME_TEST_HOOKS__.getState().player.position`을 비교해 Z가 감소하고 X는 유지되는지 검사합니다. 위치와 입력 시간은 콘솔, 테스트 출력 폴더의 `movement-positions.json`, HTML 보고서 첨부에 남습니다. 실제 키 입력과 프레임 실행에는 지연이 있을 수 있어 이동 거리를 정확히 4로 고정하지 않습니다. 스크린샷이나 수동 시뮬레이션 진행으로 판정하지 않습니다.

`test:p0`는 공격 시 적 HP 감소, 치명타 후 Game Over, Retry 초기화, 전원 처치 후 Stage Clear를 각각 독립된 테스트로 검사합니다. 매 테스트는 새 브라우저 컨텍스트와 페이지에서 기존 Hook의 `reset()`으로 기본 Seed 12345를 복원합니다. `?qa=1`에서 필요한 위치·남은 HP 등 사전조건만 준비하고 `advance()`로 실제 시뮬레이션을 일정한 틱만큼 실행합니다. 자동 발사·적중·사망·승패는 게임 로직이 처리하며, Retry는 실제 버튼을 클릭합니다. 결과는 표준 Test Hook으로 판정하고 각 테스트의 `p0-result.json`과 HTML 보고서에 전후 상태를 첨부합니다. 반복 검사는 `npm.cmd run test:p0 -- --repeat-each=3`, 개별 실행은 `npm.cmd run test:p0 -- --grep P0-01`처럼 할 수 있습니다. 테스트 간 실행 순서나 결과에 의존하지 않습니다.

브라우저가 없으면 최초 1회 `npx.cmd playwright install chromium`을 실행합니다. 브라우저 테스트는 개발 서버를 자동 실행하거나 이미 실행 중인 서버를 재사용합니다. Windows의 실제 탭 전환 검사는 설치된 Microsoft Edge의 별도 임시 프로필을 사용하며 창이 잠깐 표시됩니다. 다른 운영체제에서는 Chromium을 사용합니다.

## 파일 구조

Canvas 테스트의 입력·상태 비교·실패 증거를 묶는 최소 도우미는 `tests/helpers/game-test-adapter.js`입니다. 사용 예제와 DOM 테스트와의 차이는 [Game Test Adapter 안내](docs/GAME_TEST_ADAPTER.md)에 있습니다. `test:adapter`는 실제 키보드·마우스 입력과 의도적인 비교 실패 시 JSON 저장을 검사합니다.

```text
game/index.html          화면의 버튼·상태·캔버스
game/src/rules.js        게임 수치와 고정 생성 위치
game/src/simulation.js   화면과 독립적인 게임 규칙
game/src/renderer.js     Three.js 표시
game/src/main.js         키보드·버튼·실시간 루프·자동 일시정지
game/src/style.css       화면 배치
tests/simulation.test.js 규칙 자동 검사
tests/browser.spec.js    브라우저·키보드·버튼 검사
tests/focus.spec.js      실제 탭 전환 검사
docs/GAME_RULES.md       세부 규칙과 테스트 훅
reports/INITIAL_QA.md    이번 실행 결과와 검증 범위
evidence/*.png          확인한 화면
```

기존 폴더와 `10_Project_Skeleton/`은 그대로 보존했습니다. 개발 서버와 테스트 설정은 루트에 있으며 배포 빌드는 `dist/`에 생성됩니다. 외부 이미지·모델·서버·API 키는 사용하지 않습니다.

Three.js 설치 방식 참고: <https://threejs.org/manual/pages/installation.html>
