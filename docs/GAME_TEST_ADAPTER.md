# Game Test Adapter

## DOM과 Canvas의 차이

일반 웹의 버튼·입력창은 DOM locator와 텍스트로 검증할 수 있습니다. Canvas 안의 적과 플레이어는 각각 DOM 요소가 아니므로, 캐릭터를 CSS selector로 찾거나 스크린샷으로 HP를 추측하지 않습니다.

- Pause·Retry 같은 HTML 버튼: 기존 Playwright locator 사용.
- 게임 키보드·마우스 입력: Adapter가 Playwright의 실제 입력 API 사용.
- HP·위치·적·점수·승패: 표준 `window.__THREE_GAME_TEST_HOOKS__.getState()` 사용.

게임 규칙과 기존 테스트는 변경하지 않았습니다. 별도 실행기·설정 체계·시나리오 언어는 없습니다.

## 최소 사용 예

```js
import { test, expect } from '@playwright/test';
import { GameTestAdapter } from './helpers/game-test-adapter.js';

test('W movement', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.waitForFunction(() => !!window.__THREE_GAME_TEST_HOOKS__);
  const game = new GameTestAdapter(page, testInfo);

  await game.expectState({ stage: 1, gameState: 'playing' });
  await game.run('W changes position', async () => {
    const before = await game.readState();
    await game.holdKey('w', 1000);
    const after = await game.readState();
    expect(after.player.position.z).toBeLessThan(before.player.position.z);
  });
});
```

## API

| 메서드 | 역할 |
| --- | --- |
| `holdKey(key, durationMs)` | Canvas를 포커스하고 키를 일정 시간 누름. 오류가 나도 `finally`에서 키 해제 |
| `pressKey(key)` | Canvas 포커스 후 Esc 같은 키 1회 입력 |
| `clickCanvas(x, y, button = 'left')` | Canvas 왼쪽 위 기준 CSS 픽셀 좌표에 실제 마우스 클릭 |
| `readState()` | 표준 Test Hook의 실제 상태 복사본 읽기 |
| `expectState(expected)` | 현재 상태와 기대값을 Playwright `toMatchObject`로 부분 비교 |
| `run(operation, action)` | 위치 변화처럼 사용자 정의 검사도 실패 snapshot 대상으로 묶기 |
| `saveSnapshot(operation)` | 필요 시 현재 상태 JSON을 명시적으로 저장·첨부 |

`expectState`는 즉시 비교합니다. 자동 재시도·게임 진행·공격·HP 수정은 하지 않습니다. Canvas 클릭 좌표는 게임 월드 좌표나 PNG 픽셀 좌표가 아닙니다. 현재 게임은 마우스 기반 플레이 기능이 없으므로 클릭 지원은 이벤트 전달까지만 의미합니다.

## 실패 증거

Adapter의 입력·조회·비교 작업 또는 `run()` 내부 검사가 실패하면 테스트 출력 폴더에 `game-state-failure-N.json`을 저장하고 HTML 보고서에도 첨부합니다. 테스트 이름, URL, 작업, 시각, 오류, 실제 상태를 남기며 상태 비교 실패에는 기대값과 **비교에 사용한 바로 그 상태**를 저장합니다.

Hook이 없거나 페이지가 닫혀 상태를 읽지 못하면 `stateReadError`를 기록합니다. 저장 자체가 실패해도 최초 오류를 다시 던지고 저장 오류를 덧붙입니다. 스냅샷 저장으로 테스트를 통과시키지 않습니다.

Adapter 밖에서 직접 실행한 Playwright 검사는 자동으로 감싸지 않습니다. 사용자 정의 검사는 `run()` 안에 작성합니다. 기존 테스트를 일괄 변경하지 않았으며, 필요한 테스트부터 도입할 수 있습니다.

실행: `npm.cmd run test:adapter`. 검증 테스트 중 하나는 기대 점수 999를 의도적으로 비교해 오류가 발생하고 실제 점수 0의 JSON이 남는지 검사합니다. 이 테스트의 PASS는 실패 감지·저장 기능이 정상이라는 의미입니다.
