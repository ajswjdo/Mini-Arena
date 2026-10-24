import './style.css';
import { ArenaSimulation } from './simulation.js';
import { ArenaRenderer } from './renderer.js';
import { RULES as R, enemyShotSeconds } from './rules.js';

const simulation = new ArenaSimulation();
const byId = (id) => document.getElementById(id);
const byTest = (id) => document.querySelector(`[data-testid="${id}"]`);
const canvas = byId('arena');
const overlay = byId('overlay');
const qaMode = import.meta.env.DEV && new URLSearchParams(location.search).get('qa') === '1';
let renderer;
try {
  renderer = new ArenaRenderer(canvas);
} catch (error) {
  simulation.pause('renderer-error');
  const alert = byId('render-error');
  alert.hidden = false;
  alert.textContent = `Three.js 화면 초기화 실패: ${error.message}. WebGL을 지원하는 브라우저와 하드웨어 가속 설정을 확인해 주세요.`;
  console.error(error);
}

let accumulator = 0;
let previousTime = performance.now();
let previousStatus;
const labels = { playing: 'Playing', paused: 'Paused', 'game-over': 'Game Over', 'stage-clear': 'Stage Clear' };
function update() {
  const s = simulation.state;
  byTest('hp').textContent = `${s.player.hp} / ${R.maxHp}`;
  byId('hp-fill').style.width = `${s.player.hp}%`;
  document.querySelector('[role="progressbar"]').setAttribute('aria-valuenow', s.player.hp);
  byTest('stage').innerHTML = `${String(s.stage).padStart(2, '0')} <small>/ 03</small>`;
  byTest('defeated').innerHTML = `${s.defeated} <small>/ 3</small>`;
  const seconds = s.tick / R.tickRate;
  byTest('time').textContent = `${String(Math.floor(seconds / 60)).padStart(2,'0')}:${(seconds % 60).toFixed(1).padStart(4,'0')}`;
  byTest('status').textContent = labels[s.status];
  byId('stage-caption').textContent = String(s.stage).padStart(2, '0');
  byTest('potion-status').textContent = s.potion.collected ? '포션 획득 완료' : '포션 대기';
  byTest('enemy-interval').textContent = `${enemyShotSeconds(s.stage).toFixed(1)}초`;
  byId('pause').textContent = s.status === 'paused' ? 'Resume' : 'Pause';
  byId('pause').disabled = s.status === 'game-over' || s.status === 'stage-clear';
  overlay.hidden = s.status === 'playing';
  byId('resume').hidden = s.status !== 'paused';
  byId('next-stage').hidden = s.status !== 'stage-clear' || s.stage === R.maxStage;
  if (s.status !== 'playing') {
    byId('overlay-title').textContent = labels[s.status];
    byId('overlay-kicker').textContent = s.status === 'paused' ? 'SIMULATION PAUSED' : s.status === 'game-over' ? 'RUN ENDED' : s.stage === R.maxStage ? 'ALL 3 STAGES COMPLETE' : `STAGE ${s.stage} COMPLETE`;
    byId('overlay-description').textContent = s.status === 'paused'
      ? (s.pauseReason === 'focus-lost' ? '다른 창이나 탭으로 이동하여 일시정지했습니다. Resume 또는 Esc로 재개하세요.' : '게임 시간이 멈췄습니다. Resume 또는 Esc로 재개하세요.')
      : s.status === 'game-over' ? 'HP가 0이 되었습니다. Retry로 1단계부터 다시 시작하세요.'
        : s.stage === R.maxStage ? '3단계의 적을 모두 처치했습니다. Retry로 다시 도전할 수 있습니다.' : '적 3마리를 모두 처치했습니다. 다음 단계에서는 적이 더 빠르게 공격합니다.';
  }
  if (previousStatus !== s.status) {
    if (s.status !== 'playing') (s.status === 'paused' ? byId('resume') : s.status === 'stage-clear' && s.stage < R.maxStage ? byId('next-stage') : byId('overlay-retry')).focus({ preventScroll: true });
    previousStatus = s.status;
  }
  renderer?.render(s);
}

function action(fn, focusCanvas = false) {
  fn();
  accumulator = 0;
  previousTime = performance.now();
  update();
  if (focusCanvas) canvas.focus({ preventScroll: true });
}
function togglePause() {
  action(() => simulation.state.status === 'paused' ? simulation.resume() : simulation.pause(), simulation.state.status === 'paused');
}
byId('pause').addEventListener('click', togglePause);
byId('resume').addEventListener('click', () => action(() => simulation.resume(), true));
for (const id of ['retry', 'overlay-retry']) byId(id).addEventListener('click', () => action(() => simulation.retry(), true));
byId('next-stage').addEventListener('click', () => action(() => simulation.nextStage(), true));
const keyMap = { KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd' };
window.addEventListener('keydown', (event) => {
  if (event.code === 'Escape' && !event.repeat) {
    event.preventDefault();
    togglePause();
  } else if (keyMap[event.code]) {
    event.preventDefault();
    // After pause/retry, a held key must be released and pressed again.
    if (!event.repeat) simulation.setKey(keyMap[event.code], true);
  }
});
window.addEventListener('keyup', (event) => {
  if (keyMap[event.code]) simulation.setKey(keyMap[event.code], false);
});
function focusLost() { action(() => simulation.pause('focus-lost')); }
window.addEventListener('blur', focusLost);
document.addEventListener('visibilitychange', () => { if (document.hidden) focusLost(); });

// Production exposes read-only observations, not state mutation.
window.__ARENA__ = Object.freeze({ snapshot: () => simulation.snapshot() });
// Observe the real simulation. Returned data never contains live state references.
window.__THREE_GAME_TEST_HOOKS__ = Object.freeze({
  getState() {
    const state = simulation.snapshot();
    return {
      player: {
        hp: state.player.hp,
        position: { x: state.player.x, z: state.player.z },
      },
      enemyCount: state.enemies.length,
      enemies: state.enemies.map((enemy) => ({ id: enemy.id, hp: enemy.hp })),
      // No separate points system: score is this stage's real defeated counter.
      score: state.defeated,
      stage: state.stage,
      gameState: state.status,
    };
  },
  ...(qaMode ? { reset: () => action(() => simulation.retry()) } : {}),
});
if (qaMode) {
  byId('qa-mode').hidden = false;
  window.__ARENA_QA__ = Object.freeze({
    snapshot: () => simulation.snapshot(),
    advance: (seconds) => { const state = simulation.advance(seconds); update(); return state; },
    retry: () => action(() => simulation.retry()),
    // Controlled fixtures are available only in dev at ?qa=1.
    load: (state) => action(() => { simulation.state = structuredClone(state); }),
  });
}

function frame(now) {
  const delta = Math.min((now - previousTime) / 1000, 0.1);
  previousTime = now;
  if (!qaMode && simulation.state.status === 'playing') {
    accumulator += delta;
    while (accumulator >= 1 / R.tickRate) {
      simulation.step();
      accumulator -= 1 / R.tickRate;
    }
  } else accumulator = 0;
  update();
  requestAnimationFrame(frame);
}
update();
requestAnimationFrame(frame);
if (import.meta.hot) import.meta.hot.dispose(() => renderer?.dispose());
