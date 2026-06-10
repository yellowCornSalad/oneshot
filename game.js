/* 게임 전체를 즉시실행함수(IIFE)로 감싼다 → 내부 변수(state·RINGS·점수 등)가
 * 콘솔/개발자도구에서 이름으로 안 잡혀 직접 수정 불가(캐주얼 점수 변조 방지). */
(function () {
'use strict';

/* =========================================================================
 * ONESHOT (원샷) — 한 손가락 다트
 * (1) 누르면 좌우로 왔다갔다하던 "조준선"이 그 자리에서 멈추고
 * (2) 누르고 있는 동안 "파워 게이지"가 위아래로 차오르며
 * (3) 손을 떼는 순간의 게이지 높이로 다트가 날아간다.
 *
 * 🎯 다트 5발로 시작. 한 발 던질 때마다 1개 소모.
 *    안쪽 링(25점)·레드(50점)·BULL(100점)을 맞히면 발을 되돌려준다.
 *    → 잘 맞힐수록 계속 쏠 수 있고, 다 떨어지면 게임 오버.
 * 🔥 정중앙 BULL 적중 = 노랑 불꽃 화르륵! 충격파 + 섬광 + 묵직한 임팩트.
 *
 * 의존성 없음 — index.html 을 브라우저로 열기만 하면 실행된다.
 * ========================================================================= */

// ---------- 튜닝 상수 ----------
const AIM_RATE0 = 1.05, AIM_RATE1 = 2.60;   // 좌우 조준선 속도(주기/초): 시작 → 최대(고득점 구간 가속)
const POW_RATE0 = 1.20, POW_RATE1 = 2.90;   // 상하 파워 게이지 속도
const WAIT_FREE_CYCLES = 3;                    // 캠핑 가속 전 자유 왕복 횟수(3바퀴까지는 정상 속도)
const WAIT_ACCEL = 0.55, WAIT_ACCEL_CAP = 2.8; // 3바퀴 이후 한 바퀴당 가속 증가분 / 최대 배수
const RAMP_SCORE = 1600;                     // 이 점수에서 난이도 최대치
const WIND_FROM  = 300;                      // 이 점수부터 바람 등장
const WIND_MAX   = 0.85;                      // 바람 최대 세기(보드 반지름 비율)
const FLY_DUR    = 0.32;                      // 다트 비행 시간(초)
const RESULT_DUR = 0.34;                      // 결과 보여주는 쿨다운(초)
const DARTS0     = 5;                         // 시작 다트 수
const DART_CAP   = 12;                        // 최대 보유 다트 수
const COMBO_PER_MULT = 3;                     // 콤보 N개마다 점수 배수 +1
const MULT_CAP   = 12;
const MAX_STUCK  = 7;                         // 보드에 남겨두는 다트 수
const FIRE_COMBO = 6;                         // 이 콤보부터 🔥 ON FIRE
const FIRE_BONUS = 2;                         // ON FIRE 시 점수 추가 배수

// 목표 점수 체인 — 목표를 깰 때마다 보너스 다트 +1, 다음 목표는 점점 멀어진다.
// (정적인 미션 대신, 늘 눈앞에 "조금만 더" 목표가 보이는 단기 중독 루프)
const TARGET0 = 300;        // 첫 목표 점수 & 첫 간격
const TARGET_GROW = 1.35;   // 목표 간격 증가율(달성할수록 다음이 멀어짐 → 다트 과잉 억제)

// 점수 링: [중심에서의 최대 반지름 비율, 점수, 색]  — 안쪽부터
const RINGS = [
  [0.09, 100, '#ffd35e'], // BULL (골드)
  [0.20,  50, '#e5484d'], // 레드
  [0.40,  25, '#2c3a4a'], // 다크
  [0.62,  10, '#efe6cf'], // 크림
  [1.00,   5, '#243244'], // 다크 (가장 바깥)
];
RINGS.forEach(function (r) { Object.freeze(r); });
Object.freeze(RINGS);   // 점수값(BULL=100 등) 변조 방지
// 다트 보충: 정중앙 BULL 적중에만 +2. 그 외엔 보충 없음(매 던지기 -1).
function refillFor(val) { return val === 100 ? 2 : 0; }

// ---------- 캔버스 ----------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let W = 0, H = 0;

function resize() {
  const r = canvas.getBoundingClientRect();
  W = r.width; H = r.height;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);

// ---------- DOM ----------
const elScore = document.getElementById('score');
const elCombo = document.getElementById('combo');
const elBest = document.getElementById('best');
const elDarts = document.getElementById('darts');
const elFlash = document.getElementById('flash');
const elMute = document.getElementById('mute');
const panelStart = document.getElementById('panel-start');
const panelOver = document.getElementById('panel-over');
const panelBoard = document.getElementById('panel-board');
const panelWall = document.getElementById('panel-wall');
const elFinalScore = document.getElementById('final-score');
const elFinalBest = document.getElementById('final-best');
const elDanger = document.getElementById('danger');
const elOverGoal = document.getElementById('over-goal');
const elShareBtn = document.getElementById('over-share');
const elShareMsg = document.getElementById('share-msg');
const elMissions = document.getElementById('missions');
const elMissionResult = document.getElementById('mission-result');
const elTarget = document.getElementById('target');
const SHARE_URL = 'https://yellowcornsalad.github.io/oneshot/';

// ---------- 상태 ----------
const state = {
  mode: 'ready',      // ready | playing | over
  phase: 'aim',       // aim(좌우 조준) | power(상하 게이지) | fly(비행) | result(결과)
  score: 0,
  best: loadBest(),
  combo: 0,
  darts: DARTS0,
  throws: 0,
  aimPhase: 0,        // 좌우 조준선 위상
  powPhase: 0,        // 상하 게이지 위상
  phaseStartPh: 0,    // 현재 페이즈 시작 시점의 위상 → 경과 "바퀴 수" 계산용(캠핑 가속)
  cyFrac: 0.5,        // 보드 세로 중심 비율(메뉴 0.5 ↔ 플레이 0.37, 부드럽게 이징)
  lockX: 0,           // 멈춘 가로 위치(px)
  lockP: 0.5,         // 멈춘 게이지 값(0~1)
  windRaw: 0,         // 이번 던지기 바람 방향(-1~1)
  dart: null,         // 비행 중인 다트
  resultT: 0,
  stuck: [],          // 보드에 꽂힌 다트들
  parts: [],          // 파티클
  pops: [],           // 점수 팝업
  waves: [],          // BULL 충격파 링
  glow: null,         // BULL 골드 섬광
  shake: 0,
  time: 0,            // 누적 시간(펄스 연출)
  onFire: false,      // 🔥 ON FIRE 상태
  fireHeat: 0,        // 0~1 콤보 고조 강도(연출)
  coolT: 0,           // 콤보 끊긴 직후 식는 연출 타이머
  emberT: 0,          // 잔불 스폰 누적시간
  startBest: 0,       // 이번 판 시작 시점 최고기록(신기록 판정)
  recordHit: false,   // 이번 판 신기록 연출 했는지
  nextTarget: 0,      // 다음 목표 점수(달성 시 보너스 다트 +1)
  targetGap: 0,       // 현재 목표 간격(점점 커짐)
  bullCount: 0, bullStreak: 0, bullStreakMax: 0,   // 미션 추적
  noMissStreak: 0, noMissMax: 0, comboMax: 0, firedEver: false,
};

// ---------- 기하 (W,H 로부터 매 프레임 계산 → 리사이즈에 강함) ----------
function geom() {
  const R = Math.min(W * 0.40, H * 0.26);
  return {
    R: R,
    cx: W / 2,
    cy: H * state.cyFrac,
    sweepHalf: R * 1.06,        // 조준선이 좌우로 오가는 반폭
    launchX: W / 2,
    launchY: H * 0.93,          // 다트가 출발하는 지점(화면 하단)
    gx: W - 22,                 // 파워 게이지 바 x
  };
}

// 삼각파: 위상 ph → 0..1..0 핑퐁
function tri(ph) { const m = ((ph % 2) + 2) % 2; return m <= 1 ? m : 2 - m; }
function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function rand(a, b) { return a + Math.random() * (b - a); }

// 난이도 진행도 0~1 = 점수 + "여분 다트(5개 초과분)"
// → 잘해서 다트를 쌓을수록(>5) 조준선·게이지가 빨라지고 바람도 강해진다(호딩 억제).
function diff() {
  const byScore = state.score / RAMP_SCORE;
  const byDarts = Math.max(0, state.darts - DARTS0) / (DART_CAP - DARTS0); // 6~12발 → 0~1
  return clamp(byScore + byDarts * 0.7, 0, 1);
}
function aimRate() { return lerp(AIM_RATE0, AIM_RATE1, diff()); }
function powRate() { return lerp(POW_RATE0, POW_RATE1, diff()); }
// 현재 페이즈에서 지나간 왕복(바퀴) 수 — tri 주기 = 위상 2 = 1바퀴(좌→우→좌)
function phaseCycles() {
  const ph = state.phase === 'power' ? state.powPhase : state.aimPhase;
  return (ph - state.phaseStartPh) / 2;
}
// 3바퀴까지는 정상 속도, 그 이후부터 바퀴당 가속(완벽한 순간을 무한정 기다리는 캠핑 억제)
function waitAccel() {
  const over = phaseCycles() - WAIT_FREE_CYCLES;
  return over <= 0 ? 1 : clamp(1 + WAIT_ACCEL * over, 1, WAIT_ACCEL_CAP);
}
function windAmp(g) {
  if (state.score < WIND_FROM) return 0;
  return (0.4 + 0.6 * diff()) * WIND_MAX * g.R;   // 등장하자마자 체감, diff(점수+여분다트)로 강해짐
}

function currentSweepX(g) { return g.cx + (tri(state.aimPhase) * 2 - 1) * g.sweepHalf; }
function currentP() { return tri(state.powPhase); }

// 거리비율 → 점수 / 색
function scoreFor(frac) {
  for (let i = 0; i < RINGS.length; i++) if (frac <= RINGS[i][0]) return RINGS[i][1];
  return 0; // 보드 밖 = 빗나감
}
function colorFor(frac) {
  for (let i = 0; i < RINGS.length; i++) if (frac <= RINGS[i][0]) return RINGS[i][2];
  return '#888';
}
function multiplier() { return Math.min(MULT_CAP, 1 + Math.floor(state.combo / COMBO_PER_MULT)); }

// ---------- 게임 흐름 ----------
function resetStats() {
  state.score = 0; state.combo = 0; state.darts = DARTS0; state.throws = 0;
  state.stuck = []; state.parts = []; state.pops = []; state.waves = []; state.glow = null; state.shake = 0;
  state.onFire = false; state.fireHeat = 0; state.coolT = 0; state.emberT = 0; state.recordHit = false;
  state.bullCount = 0; state.bullStreak = 0; state.bullStreakMax = 0;
  state.noMissStreak = 0; state.noMissMax = 0; state.comboMax = 0; state.firedEver = false;
  state.dart = null;
  state.nextTarget = TARGET0; state.targetGap = TARGET0;   // 목표 체인 초기화
  if (elDanger) elDanger.classList.remove('on');
  updateHud();
}

// ---------- 미션 ----------
function advanceTarget() {
  state.targetGap = Math.round(state.targetGap * TARGET_GROW);   // 다음 간격은 더 멀게
  state.nextTarget += state.targetGap;
}
// 점수가 다음 목표를 넘으면 보너스 다트 +1 + 화려한 연출 (한 번에 여러 목표를 넘으면 반복, 최대 5)
function checkTarget(x, y) {
  let n = 0;
  while (state.score >= state.nextTarget && n < 5) {
    state.darts = Math.min(DART_CAP, state.darts + 1);
    addPop(x, y - 78 - n * 26, '🎯 보너스 +1', '#ffd35e', true);
    flashText('🎯 ' + state.nextTarget.toLocaleString() + ' 클리어!');
    playReward();
    pulseDarts('gain');
    advanceTarget();
    n++;
  }
}
function renderStartTeaser() {
  if (!elMissions) return;
  elMissions.innerHTML =
    '<div class="mtitle">🎯 목표 점수를 깰 때마다 다트 +1</div>' +
    '<span class="mi">첫 목표 <b>' + TARGET0 + '점</b></span>' +
    '<span class="mi">살아남아 최고 점수에 도전!</span>';
}
function playReward() { blip(660, 0.12, 'triangle', 0.13); setTimeout(function () { blip(990, 0.16, 'triangle', 0.12); }, 90); }

function resetGame() {
  state.mode = 'ready';
  state.phase = 'aim';
  resetStats();
  renderStartTeaser();
  showPanel('start');
}
function startGame() {
  if (state.mode === 'playing') return;
  resetStats();
  state.startBest = state.best;     // 이번 판 동안 깰 목표(신기록 판정)
  state.mode = 'playing';
  hidePanels();
  if (window.Leaderboard && window.Leaderboard.onStart) window.Leaderboard.onStart();  // 플레이 토큰 발급
  newThrow();
  updateHud();   // 시작과 동시에 HUD(다음 목표 등) 표시
}
function newThrow() {
  state.phase = 'aim';
  state.phaseStartPh = state.aimPhase;   // 이번 조준 시작 위상 기록(바퀴 수 계산 기준)
  // 바람: 불 땐 항상 ±0.5~1 세기(너무 약하게 안 불도록)
  state.windRaw = state.score < WIND_FROM ? 0 : (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.5);
}

function launchDart() {
  const g = geom();
  const tx = clamp(state.lockX + state.windRaw * windAmp(g), 8, W - 8);
  const ty = g.cy + (0.5 - state.lockP) * 2 * g.R;
  const ang = Math.atan2(ty - g.launchY, tx - g.launchX) + Math.PI / 2; // 진행 방향
  state.dart = { x: g.launchX, y: g.launchY, x0: g.launchX, y0: g.launchY, x1: tx, y1: ty, t: 0, ang: ang };
  state.phase = 'fly';
  playThrow();
}

function resolveHit() {
  const g = geom();
  const d = state.dart;
  const dist = Math.hypot(d.x1 - g.cx, d.y1 - g.cy);
  const frac = dist / g.R;
  const val = scoreFor(frac);
  state.throws++;

  const prevDarts = state.darts;
  state.darts--;                      // 한 발 소모

  if (val > 0) {
    const wasFire = state.onFire;
    state.combo++;
    state.onFire = state.combo >= FIRE_COMBO;
    const justFired = state.onFire && !wasFire;
    const isBull = val === 100;
    const nearBull = !isBull && frac < 0.135;   // BULL 을 아슬하게 빗나감

    // 미션 추적
    state.noMissStreak++; state.noMissMax = Math.max(state.noMissMax, state.noMissStreak);
    if (isBull) { state.bullCount++; state.bullStreak++; state.bullStreakMax = Math.max(state.bullStreakMax, state.bullStreak); }
    else { state.bullStreak = 0; }
    state.comboMax = Math.max(state.comboMax, state.combo);
    if (state.onFire) state.firedEver = true;

    const baseMult = multiplier();
    const effMult = baseMult * (state.onFire ? FIRE_BONUS : 1);   // ON FIRE면 추가 배수
    const pts = val * effMult;
    state.score += pts;
    addPop(d.x1, d.y1, '+' + pts, isBull ? '#ffd35e' : '#ffffff', isBull);

    const rf = refillFor(val);          // 다트 보충 (BULL만 +2)
    if (rf > 0) {
      state.darts = Math.min(DART_CAP, state.darts + rf);
      addPop(d.x1, d.y1 - 30, '+' + rf + ' 🎯', '#46d369', false);
    }
    addStuck(d.x1, d.y1);

    // 신기록: 이번 판 처음으로 시작 시점 최고기록 돌파 → 보너스 다트 +1
    const justRecord = !state.recordHit && state.startBest > 0 && state.score > state.startBest;
    if (justRecord) {
      state.recordHit = true;
      state.darts = Math.min(DART_CAP, state.darts + 1);
      addPop(d.x1, d.y1 - 56, '+1 🎯', '#ffd35e', false);
    }

    if (isBull) { bullImpact(d.x1, d.y1); playBull(); }
    else { state.shake = Math.max(state.shake, 0.12); burst(d.x1, d.y1, colorFor(frac), justFired ? 22 : 12); playHit(val); }
    if (justFired) playFire();
    if (justRecord) playRecord();

    // 플래시 우선순위: 신기록 > BULL > ON FIRE 진입 > 아슬 (인게임 텍스트는 영어로 통일)
    let flash = '';
    if (justRecord) flash = 'NEW BEST!';
    else if (isBull) flash = effMult > 1 ? '🔥 BULLSEYE ×' + effMult + ' 🔥' : '🔥 BULLSEYE 🔥';
    else if (justFired) flash = '🔥 ON FIRE 🔥';
    else if (nearBull) flash = 'SO CLOSE!';
    if (flash) flashText(flash);
  } else {
    const wasFire = state.onFire;
    const nearMiss = frac < 1.18;       // 보드 바로 바깥 = 아슬아슬
    state.combo = 0;
    state.onFire = false;
    state.noMissStreak = 0; state.bullStreak = 0;   // 미션 연속 끊김
    addPop(d.x1, d.y1, 'MISS', '#e5484d', false);
    burst(d.x1, d.y1, '#e5484d', 8);
    state.shake = Math.max(state.shake, 0.22);
    playMiss();
    if (wasFire) { state.coolT = 0.6; playCool(); }   // 콤보 끊김: 식는 연출만(텍스트 없음)
    else if (nearMiss) flashText('SO CLOSE!');
  }

  checkTarget(d.x1, d.y1);   // 목표 점수 달성 체크(보너스 다트)

  // 다트 수 변화 펄스
  const net = state.darts - prevDarts;
  if (net > 0) pulseDarts('gain'); else if (net < 0) pulseDarts('loss');

  if (state.score > state.best) { state.best = state.score; saveBest(state.best); }
  if (state.darts === 1 && prevDarts !== 1) playTension();   // 막판(마지막 1발) 진입
  updateHud();

  state.dart = null;
  state.phase = 'result';
  state.resultT = 0;
}

function gameOver() {
  state.mode = 'over';
  state.shake = 0.42;
  if (elDanger) elDanger.classList.remove('on');
  if (elOverGoal) {
    if (state.startBest > 0 && state.score > state.startBest) elOverGoal.textContent = '🎉 자체 최고기록 경신!';
    else if (state.startBest > 0) elOverGoal.textContent = '최고기록까지 단 ' + (state.startBest - state.score) + '점!';
    else elOverGoal.textContent = '첫 기록! 순위에 올려보세요 🏆';
  }
  showPanel('over');
  if (window.Leaderboard) window.Leaderboard.onOver();
}

// ---------- 업데이트 ----------
function update(dt) {
  state.time += dt;
  // 보드 세로 중심: 플레이 중엔 위쪽(0.37), 메뉴/패널에선 가운데(0.5)로 부드럽게 이동 → 패널과 중심 정렬
  const panelOpen = (window.Leaderboard && window.Leaderboard.isOpen && window.Leaderboard.isOpen()) ||
                    (window.Wall && window.Wall.isOpen && window.Wall.isOpen());
  const cyTarget = (state.mode === 'playing' && !panelOpen) ? 0.37 : 0.5;
  state.cyFrac += (cyTarget - state.cyFrac) * Math.min(1, dt * 7);
  const gg = geom();
  // 콤보 고조 강도 — 콤보 기반 목표치로 부드럽게 이징
  const heatTarget = state.mode === 'playing' ? clamp(state.combo / FIRE_COMBO, 0, 1) : 0;
  state.fireHeat += (heatTarget - state.fireHeat) * Math.min(1, dt * 6);
  if (state.coolT > 0) state.coolT = Math.max(0, state.coolT - dt);
  // ON FIRE 잔불 솟기
  if (state.mode === 'playing' && state.onFire) {
    state.emberT += dt;
    while (state.emberT > 0.05) { state.emberT -= 0.05; spawnEmber(gg); }
  }

  if (state.mode === 'playing') {
    if (state.phase === 'aim') {
      state.aimPhase += aimRate() * waitAccel() * dt;
    } else if (state.phase === 'power') {
      state.powPhase += powRate() * waitAccel() * dt;
      setChargePitch(currentP());
    } else if (state.phase === 'fly') {
      const d = state.dart;
      d.t += dt;
      const e = clamp(d.t / FLY_DUR, 0, 1);
      d.x = lerp(d.x0, d.x1, e);
      d.y = lerp(d.y0, d.y1, e) - Math.sin(e * Math.PI) * 46; // 살짝 포물선
      if (e >= 1) resolveHit();
    } else if (state.phase === 'result') {
      state.resultT += dt;
      if (state.resultT >= RESULT_DUR) {
        if (state.darts <= 0) gameOver();
        else newThrow();
      }
    }
  }

  // 파티클 (일반 + 불꽃)
  for (let i = state.parts.length - 1; i >= 0; i--) {
    const p = state.parts[i];
    if (p.flame) {
      p.vy += 90 * dt;            // 약한 중력 → 솟았다가 천천히
      p.vx *= (1 - 1.8 * dt);     // 공기저항
      p.vy *= (1 - 0.5 * dt);
    } else {
      p.vy += 520 * dt;
    }
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.life -= dt;
    if (p.life <= 0) state.parts.splice(i, 1);
  }
  // 충격파
  for (let i = state.waves.length - 1; i >= 0; i--) {
    state.waves[i].t += dt;
    if (state.waves[i].t >= state.waves[i].life) state.waves.splice(i, 1);
  }
  // 섬광
  if (state.glow) { state.glow.t += dt; if (state.glow.t >= state.glow.life) state.glow = null; }
  // 점수 팝업
  for (let i = state.pops.length - 1; i >= 0; i--) {
    const p = state.pops[i];
    p.t += dt; p.y -= 34 * dt;
    if (p.t >= p.life) state.pops.splice(i, 1);
  }
  // 화면 흔들림 감쇠
  if (state.shake > 0) state.shake = Math.max(0, state.shake - dt);
}

// ---------- 렌더 ----------
function render() {
  const g = geom();
  ctx.clearRect(0, 0, W, H);
  drawBackground(g);

  // 흔들림: "장면"(보드/다트/파티클)만 흔든다. 게이지/HUD 는 고정.
  const amp = state.shake > 0 ? state.shake * 18 : 0;
  const ox = amp ? rand(-amp, amp) : 0;
  const oy = amp ? rand(-amp, amp) : 0;

  ctx.save();
  ctx.translate(ox, oy);
  drawBoard(g);
  drawCenterGuide(g);
  drawStuck(g);
  drawGlow();          // BULL 골드 섬광 (가산)
  drawWaves();         // BULL 충격파 (가산)
  drawAimAndPower(g);
  drawReadyDart(g);
  drawFlyingDart(g);
  drawParticles();
  drawPops();
  ctx.restore();

  drawGauge(g);   // 우측 파워 게이지 (고정)
  drawWind(g);    // 바람 표시 (고정)
}

// 몽실몽실 떠다니는 구름 (배경 위, 보드 뒤)
const CLOUDS = [
  { x: 0.16, y: 0.12, s: 1.10, spd: 0.010 },
  { x: 0.74, y: 0.08, s: 0.85, spd: 0.014 },
  { x: 0.46, y: 0.25, s: 1.30, spd: 0.008 },
  { x: 0.88, y: 0.72, s: 0.95, spd: 0.011 },
  { x: 0.08, y: 0.64, s: 1.05, spd: 0.013 },
  { x: 0.56, y: 0.88, s: 0.80, spd: 0.012 },
];
const CLOUD_BLOBS = [[0, 0, 1], [-0.82, 0.12, 0.66], [0.82, 0.14, 0.68], [-0.42, -0.34, 0.6], [0.46, -0.3, 0.64], [0.05, -0.18, 0.82]];
function softBlob(x, y, r, a) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, 'rgba(255,255,255,' + a + ')');
  g.addColorStop(0.55, 'rgba(255,255,255,' + (a * 0.78) + ')');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
}
function drawClouds() {
  const u = Math.min(W, H);
  for (let i = 0; i < CLOUDS.length; i++) {
    const c = CLOUDS[i];
    const cx = (((c.x + state.time * c.spd) % 1.25) - 0.12) * W;   // 천천히 흐르며 순환
    const cy = c.y * H;
    const r = c.s * u * 0.10;
    for (let b = 0; b < CLOUD_BLOBS.length; b++) {
      softBlob(cx + CLOUD_BLOBS[b][0] * r, cy + CLOUD_BLOBS[b][1] * r, CLOUD_BLOBS[b][2] * r, 0.40);
    }
  }
}

function drawBackground(g) {
  // 밝고 이쁘장한 트와일라잇 그라데이션(플레이 화면도 밝게 — 단 불꽃/조준선이 살도록 중간톤 유지)
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#6d80c4');
  bg.addColorStop(0.5, '#8a82c4');
  bg.addColorStop(1, '#a98ac0');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  drawClouds();   // 몽실몽실 구름
  // 다트보드 뒤 스포트라이트 — 살짝 더 밝게(보드가 또렷하게 떠 보이도록)
  const sx = g.cx, sy = g.cy - g.R * 0.12;
  const sp = ctx.createRadialGradient(sx, sy, g.R * 0.2, sx, sy, g.R * 2.45);
  sp.addColorStop(0, 'rgba(190,206,236,.50)');
  sp.addColorStop(0.42, 'rgba(122,142,182,.22)');
  sp.addColorStop(0.75, 'rgba(72,86,118,.09)');
  sp.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = sp;
  ctx.fillRect(0, 0, W, H);
  // 🔥 콤보 고조 시 따뜻한 화염 틴트 (ON FIRE 면 맥박)
  if (state.fireHeat > 0.01) {
    const h = state.fireHeat;
    const pulse = state.onFire ? (0.82 + 0.18 * Math.sin(state.time * 9)) : 1;
    const fg = ctx.createRadialGradient(g.cx, g.cy, g.R * 0.2, g.cx, g.cy, g.R * 2.6);
    fg.addColorStop(0, 'rgba(255,140,40,' + (0.24 * h * pulse) + ')');
    fg.addColorStop(0.5, 'rgba(255,90,30,' + (0.13 * h * pulse) + ')');
    fg.addColorStop(1, 'rgba(255,80,20,0)');
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = fg;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
  }
  // 바닥 발사대 옅은 빛 (대기 중인 다트가 어둠에 묻히지 않게)
  const r = ctx.createRadialGradient(g.launchX, g.launchY, 4, g.launchX, g.launchY, g.R * 1.05);
  r.addColorStop(0, 'rgba(255,255,255,.06)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = r;
  ctx.fillRect(0, 0, W, H);
}

function drawBoard(g) {
  ctx.beginPath();
  ctx.arc(g.cx, g.cy, g.R * 1.07, 0, Math.PI * 2);
  ctx.fillStyle = '#11161f';
  ctx.fill();
  for (let i = RINGS.length - 1; i >= 0; i--) {
    ctx.beginPath();
    ctx.arc(g.cx, g.cy, g.R * RINGS[i][0], 0, Math.PI * 2);
    ctx.fillStyle = RINGS[i][2];
    ctx.fill();
  }
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = 'rgba(201,168,96,.55)';
  for (let i = 0; i < RINGS.length; i++) {
    ctx.beginPath();
    ctx.arc(g.cx, g.cy, g.R * RINGS[i][0], 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(g.cx - g.R * 0.025, g.cy - g.R * 0.025, g.R * 0.045, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,.35)';
  ctx.fill();

  // 🔥 콤보 고조 시 불타는 테두리
  if (state.fireHeat > 0.01) {
    const h = state.fireHeat;
    const pulse = state.onFire ? (0.7 + 0.3 * Math.sin(state.time * 10)) : 1;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(255,150,40,' + (0.55 * h * pulse) + ')';
    ctx.lineWidth = 4 + 11 * h;
    ctx.beginPath(); ctx.arc(g.cx, g.cy, g.R * 1.07, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,224,130,' + (0.5 * h * pulse) + ')';
    ctx.lineWidth = 2 + 3 * h;
    ctx.beginPath(); ctx.arc(g.cx, g.cy, g.R * 1.05, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
}

function drawCenterGuide(g) {
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,.12)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 6]);
  ctx.beginPath();
  ctx.moveTo(g.cx, g.cy - g.R * 1.07); ctx.lineTo(g.cx, g.cy + g.R * 1.07);
  ctx.moveTo(g.cx - g.R * 1.07, g.cy); ctx.lineTo(g.cx + g.R * 1.07, g.cy);
  ctx.stroke();
  ctx.restore();
}

function drawAimAndPower(g) {
  if (state.mode !== 'playing') return;
  const top = g.cy - g.R * 1.07, bot = g.cy + g.R * 1.07;
  const left = g.cx - g.R * 1.07, right = g.cx + g.R * 1.07;

  const acc = (waitAccel() - 1) / (WAIT_ACCEL_CAP - 1);   // 0..1 캠핑 가속 정도(오래 끌수록↑)
  if (state.phase === 'aim') {
    const x = currentSweepX(g);
    const gch = Math.round(255 - 150 * acc), bch = Math.round(255 - 205 * acc);  // 흰색→붉은주황(서두르라는 신호)
    ctx.strokeStyle = 'rgba(255,' + gch + ',' + bch + ',.9)';
    ctx.lineWidth = 2 + acc * 1.6;
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bot); ctx.stroke();
    drawTriMarker(x, top - 6, true);
  } else if (state.phase === 'power') {
    const p = currentP();
    const y = g.cy + (0.5 - p) * 2 * g.R;
    ctx.strokeStyle = 'rgba(255,255,255,.55)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(state.lockX, top); ctx.lineTo(state.lockX, bot); ctx.stroke();
    const gch = Math.round(211 - 121 * acc), bch = Math.round(94 - 44 * acc);     // 골드→붉은주황
    ctx.strokeStyle = 'rgba(255,' + gch + ',' + bch + ',.95)';
    ctx.lineWidth = 2 + acc * 1.6;
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
    ctx.fillStyle = '#ffd35e';
    ctx.beginPath(); ctx.arc(state.lockX, y, 4.5, 0, Math.PI * 2); ctx.fill();
    drawTriMarker(state.lockX, top - 6, true);
  }
}

function drawTriMarker(x, y, down) {
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(x, y + (down ? 8 : -8));
  ctx.lineTo(x - 6, y);
  ctx.lineTo(x + 6, y);
  ctx.closePath();
  ctx.fill();
}

function drawReadyDart(g) {
  if (state.mode !== 'playing') return;
  if (state.phase === 'aim' || state.phase === 'power') {
    drawDart(g.launchX, g.launchY, 1, 0, state.phase === 'power');
  }
}

function drawFlyingDart(g) {
  if (state.phase !== 'fly' || !state.dart) return;
  const d = state.dart;
  const e = clamp(d.t / FLY_DUR, 0, 1);
  drawDart(d.x, d.y, lerp(1, 0.5, e), d.ang, false);
}

function drawDart(x, y, s, ang, glow) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  if (glow) { ctx.shadowColor = 'rgba(255,211,94,.8)'; ctx.shadowBlur = 14; }
  ctx.strokeStyle = '#d7dde6';
  ctx.lineWidth = 3.4 * s;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(0, 20 * s); ctx.lineTo(0, -14 * s); ctx.stroke();
  ctx.fillStyle = '#aab3c0';
  ctx.beginPath();
  ctx.moveTo(0, -22 * s); ctx.lineTo(-3 * s, -14 * s); ctx.lineTo(3 * s, -14 * s);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#e5484d';
  ctx.beginPath();
  ctx.moveTo(0, 10 * s); ctx.lineTo(-8 * s, 24 * s); ctx.lineTo(0, 20 * s); ctx.lineTo(8 * s, 24 * s);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

function drawStuck(g) {
  for (let i = 0; i < state.stuck.length; i++) {
    const s = state.stuck[i];
    const fade = 0.4 + 0.6 * ((i + 1) / state.stuck.length);
    ctx.globalAlpha = fade;
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(0.5);
    ctx.strokeStyle = '#cfd6df';
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 13); ctx.stroke();
    ctx.fillStyle = '#e5484d';
    ctx.beginPath();
    ctx.moveTo(0, 7); ctx.lineTo(-5, 16); ctx.lineTo(0, 13); ctx.lineTo(5, 16);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#222';
    ctx.beginPath(); ctx.arc(0, 0, 2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

function drawParticles() {
  // 일반 파티클
  for (const p of state.parts) {
    if (p.flame) continue;
    ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
  }
  // 불꽃 파티클 (가산 혼합 → 발광)
  ctx.globalCompositeOperation = 'lighter';
  for (const p of state.parts) {
    if (!p.flame) continue;
    const a = clamp(p.life / p.max, 0, 1);
    ctx.globalAlpha = a;
    ctx.fillStyle = p.color;
    const sz = p.size * (0.35 + 0.65 * a);
    ctx.beginPath(); ctx.arc(p.x, p.y, sz, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

function drawWaves() {
  if (!state.waves.length) return;
  ctx.globalCompositeOperation = 'lighter';
  for (const w of state.waves) {
    if (w.t < 0) continue;
    const e = clamp(w.t / w.life, 0, 1);
    ctx.globalAlpha = (1 - e) * 0.9;
    ctx.strokeStyle = '#ffd35e';
    ctx.lineWidth = lerp(9, 0.5, e);
    ctx.beginPath(); ctx.arc(w.x, w.y, e * w.maxR, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

function drawGlow() {
  if (!state.glow) return;
  const e = clamp(state.glow.t / state.glow.life, 0, 1);
  const a = 1 - e;
  const R = geom().R;
  const rad = R * (0.8 + e * 1.9);
  const gr = ctx.createRadialGradient(state.glow.x, state.glow.y, 0, state.glow.x, state.glow.y, rad);
  gr.addColorStop(0, 'rgba(255,255,240,' + (0.85 * a) + ')');
  gr.addColorStop(0.22, 'rgba(255,214,110,' + (0.5 * a) + ')');
  gr.addColorStop(0.55, 'rgba(255,150,45,' + (0.24 * a) + ')');
  gr.addColorStop(1, 'rgba(255,120,20,0)');
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = gr;
  ctx.fillRect(0, 0, W, H);
  // 초반 순간 백색 코어 펑!
  if (state.glow.t < 0.12) {
    const ca = 1 - state.glow.t / 0.12;
    ctx.globalAlpha = ca;
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(state.glow.x, state.glow.y, R * 0.5 * (0.6 + 0.4 * ca), 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.globalCompositeOperation = 'source-over';
}

function drawPops() {
  ctx.textAlign = 'center';
  for (const p of state.pops) {
    const a = clamp(1 - (p.t / p.life), 0, 1);
    ctx.globalAlpha = a;
    ctx.fillStyle = p.color;
    ctx.font = (p.big ? 900 : 800) + ' ' + (p.big ? 34 : 22) + 'px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(p.text, p.x, p.y);
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'start';
}

function drawGauge(g) {
  if (state.mode !== 'playing') return;
  const top = g.cy - g.R, bot = g.cy + g.R, h = bot - top;
  const x = g.gx, w = 12;
  roundRect(x - w / 2, top, w, h, 6);
  ctx.fillStyle = 'rgba(255,255,255,.08)';
  ctx.fill();
  const bandH = h * 0.10;
  roundRect(x - w / 2, g.cy - bandH / 2, w, bandH, 4);
  ctx.fillStyle = 'rgba(255,211,94,.55)';
  ctx.fill();
  if (state.phase === 'power') {
    const p = currentP();
    const fh = h * p;
    roundRect(x - w / 2, bot - fh, w, fh, 6);
    ctx.fillStyle = '#ffd35e';
    ctx.fill();
    const yy = bot - fh;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x - w / 2 - 4, yy); ctx.lineTo(x + w / 2 + 4, yy); ctx.stroke();
  }
}

function drawWind(g) {
  if (state.mode !== 'playing' || state.score < WIND_FROM) return;
  const amp = windAmp(g);
  if (amp <= 0) return;
  const dir = state.windRaw >= 0 ? 1 : -1;
  const strength = Math.abs(state.windRaw);             // 0.5~1
  const cx = W / 2;
  const y = Math.max(H * 0.13, g.cy - g.R * 1.07 - 32); // 보드 위로 충분히 띄워 십자선과 분리
  const len = 30 + strength * 40;
  const halfW = len + 34;
  ctx.save();
  // 배경 알약 — 보드/십자선 위에서도 화살표가 또렷하게
  ctx.fillStyle = 'rgba(8,12,20,.66)';
  roundRect(cx - halfW, y - 22, halfW * 2, 36, 16);
  ctx.fill();
  ctx.strokeStyle = 'rgba(127,209,255,.22)'; ctx.lineWidth = 1; ctx.stroke();
  // 라벨
  ctx.font = '800 10px "Segoe UI", system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(150,220,255,.92)';
  ctx.fillText('W I N D', cx, y - 9);
  // 큼직한 화살표 — 강풍이면 주황 경고색, 길이로 세기 표현
  const col = strength > 0.8 ? '#ff8a5b' : '#7fd1ff';
  ctx.strokeStyle = col; ctx.fillStyle = col;
  ctx.lineWidth = 5; ctx.lineCap = 'round';
  const yy = y + 6;
  ctx.beginPath(); ctx.moveTo(cx - dir * len, yy); ctx.lineTo(cx + dir * (len - 13), yy); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx + dir * len, yy);
  ctx.lineTo(cx + dir * (len - 17), yy - 11);
  ctx.lineTo(cx + dir * (len - 17), yy + 11);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

function roundRect(x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ---------- 효과 ----------
function addPop(x, y, text, color, big) {
  state.pops.push({ x: x, y: y - 14, text: text, color: color, t: 0, life: big ? 1.1 : 0.85, big: big });
}
function burst(x, y, color, n) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2);
    const sp = rand(60, 260);
    state.parts.push({
      x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60,
      life: rand(0.5, 0.9), max: 0.9, size: rand(1.5, 4), color: color,
    });
  }
}
function addStuck(x, y) {
  state.stuck.push({ x: x, y: y });
  if (state.stuck.length > MAX_STUCK) state.stuck.shift();
}

// 🔥 BULL 적중 — 노랑 불꽃 화르륵 대폭발 + 충격파 + 섬광
function bullImpact(x, y) {
  const g = geom();
  state.shake = Math.max(state.shake, 0.72);
  state.glow = { x: x, y: y, t: 0, life: 0.62 };
  state.waves.push({ x: x, y: y, t: 0, life: 0.5, maxR: g.R * 1.9 });
  state.waves.push({ x: x, y: y, t: -0.08, life: 0.5, maxR: g.R * 1.3 });
  state.waves.push({ x: x, y: y, t: -0.16, life: 0.45, maxR: g.R * 0.8 });
  flameBurst(x, y);
}
const FLAME = ['#fff6c2', '#ffe27a', '#ffd35e', '#ff9f1c', '#ff6b1a', '#ef4d3a'];
function flameBurst(x, y) {
  // 조밀한 불덩이 코어 (천천히 퍼지며 잠깐 뭉쳐 있음)
  for (let i = 0; i < 46; i++) {
    const a = rand(0, Math.PI * 2);
    const sp = rand(30, 190);
    state.parts.push({
      x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120,
      life: rand(0.5, 1.25), max: 1.25, size: rand(4, 11), color: FLAME[(Math.random() * FLAME.length) | 0], flame: true,
    });
  }
  // 바깥으로 튀는 빠른 불티
  for (let i = 0; i < 40; i++) {
    const a = rand(0, Math.PI * 2);
    const sp = rand(220, 540);
    state.parts.push({
      x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 100,
      life: rand(0.35, 0.8), max: 0.9, size: rand(2, 6), color: FLAME[(Math.random() * FLAME.length) | 0], flame: true,
    });
  }
  // 흰 스파크
  for (let i = 0; i < 16; i++) {
    const a = rand(0, Math.PI * 2);
    const sp = rand(180, 520);
    state.parts.push({
      x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 90,
      life: rand(0.22, 0.5), max: 0.5, size: rand(1.5, 3.5), color: '#ffffff', flame: true,
    });
  }
  // 위로 오래 솟는 잔불 (화르륵 여운)
  for (let i = 0; i < 12; i++) {
    const a = rand(-Math.PI * 0.85, -Math.PI * 0.15);
    const sp = rand(60, 240);
    state.parts.push({
      x: x + rand(-10, 10), y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60,
      life: rand(0.8, 1.5), max: 1.5, size: rand(3, 7), color: FLAME[(Math.random() * 3) | 0], flame: true,
    });
  }
}

// ON FIRE 중 보드에서 솟아오르는 잔불 한 톨
function spawnEmber(g) {
  state.parts.push({
    x: g.cx + rand(-g.R, g.R), y: g.cy + g.R * rand(0.0, 1.0),
    vx: rand(-22, 22), vy: rand(-130, -55),
    life: rand(0.5, 1.1), max: 1.1, size: rand(1.5, 3.5),
    color: FLAME[(Math.random() * 4) | 0], flame: true,
  });
}

// ---------- 메인 루프 ----------
let last = 0;
function frame(t) {
  if (!last) last = t;
  let dt = (t - last) / 1000;
  last = t;
  if (dt > 0.05) dt = 0.05;
  update(dt);
  render();
  requestAnimationFrame(frame);
}

// ---------- HUD / 패널 ----------
let dartsPulseTimer = null;
function pulseDarts(kind) {
  elDarts.classList.remove('gain', 'loss');
  void elDarts.offsetWidth;
  elDarts.classList.add(kind);
  if (dartsPulseTimer) clearTimeout(dartsPulseTimer);
  dartsPulseTimer = setTimeout(function () { elDarts.classList.remove('gain', 'loss'); }, 480);
}
function updateHud() {
  elScore.textContent = state.score;
  const m = multiplier();
  if (state.onFire) {
    elCombo.textContent = '🔥 ON FIRE  ×' + (m * FIRE_BONUS) + '  ·  ' + state.combo + ' COMBO';
    elCombo.classList.add('fire');
  } else {
    elCombo.textContent = state.combo > 1 ? ('🔥 ' + state.combo + ' COMBO' + (m > 1 ? '  ×' + m : '')) : '';
    elCombo.classList.remove('fire');
  }
  elBest.textContent = 'BEST ' + state.best;
  elDarts.innerHTML = '<span class="dicon">🎯</span><span class="dnum">' + state.darts + '</span>';
  if (elTarget) elTarget.textContent = state.mode === 'playing' ? ('🎯 다음 목표 ' + state.nextTarget.toLocaleString()) : '';
  if (elDanger) elDanger.classList.toggle('on', state.mode === 'playing' && state.darts === 1);
}
function showPanel(which) {
  panelBoard.classList.add('hidden');
  if (panelWall) panelWall.classList.add('hidden');
  if (which === 'start') {
    panelStart.classList.remove('hidden');
    panelOver.classList.add('hidden');
  } else {
    elFinalScore.textContent = state.score;
    elFinalBest.textContent = 'BEST ' + state.best;
    panelOver.classList.remove('hidden');
    panelStart.classList.add('hidden');
  }
}
function hidePanels() {
  panelStart.classList.add('hidden');
  panelOver.classList.add('hidden');
  panelBoard.classList.add('hidden');
  if (panelWall) panelWall.classList.add('hidden');
}
function flashText(txt) {
  elFlash.textContent = txt;
  elFlash.classList.remove('show');
  void elFlash.offsetWidth;
  elFlash.classList.add('show');
}

// ---------- 점수 자랑하기(공유) ----------
function shareMsg(t) {
  if (!elShareMsg) return;
  elShareMsg.textContent = t || '';
  if (t) setTimeout(function () { if (elShareMsg) elShareMsg.textContent = ''; }, 2600);
}
function shareScore() {
  let nm = '';
  try { nm = (document.getElementById('name-input').value || '').trim(); } catch (e) {}
  if (!nm) nm = '친구';
  const text = '🎯 ' + nm + '님, ONESHOT에서 ' + state.score + '점 기록! 🔥 이 점수 깰 수 있어? 한 판 들어와봐 👉';
  const full = text + ' ' + SHARE_URL;
  if (navigator.share) {
    // 모바일/지원 브라우저 → 네이티브 공유 시트(카톡·슬랙 등 + 게임 링크)
    navigator.share({ title: '🎯 ONESHOT ' + state.score + '점!', text: text, url: SHARE_URL })
      .then(function () { shareMsg('공유했어요! 🎯'); })
      .catch(function () {});
  } else if (navigator.clipboard && navigator.clipboard.writeText) {
    // 데스크톱 등 → 클립보드 복사 후 카톡/슬랙에 붙여넣기
    navigator.clipboard.writeText(full)
      .then(function () { shareMsg('📋 복사됐어요! 카톡·슬랙에 붙여넣기'); })
      .catch(function () { try { window.prompt('복사해서 공유하세요 (Ctrl+C)', full); } catch (e) {} });
  } else {
    try { window.prompt('복사해서 공유하세요 (Ctrl+C)', full); } catch (e) {}
  }
}

// ---------- 사운드 (Web Audio, 합성음) ----------
let actx = null, muted = false, chargeOsc = null, chargeGain = null, audioWarmed = false, master = null;
function ensureAudio() {
  if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
  if (actx && !master) {
    // 마스터 버스: 게인 + 로우패스로 거친 고음(모기 '엥~' 버즈)을 부드럽게 깎는다
    master = actx.createGain(); master.gain.value = 0.85;
    const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200; lp.Q.value = 0.3;
    master.connect(lp); lp.connect(actx.destination);
  }
  if (actx && actx.state === 'suspended') actx.resume();
  // 첫 사운드 jank 제거: 최초 제스처 때 무음 톤으로 오디오 그래프를 미리 깨워둔다.
  if (actx && !audioWarmed) {
    audioWarmed = true;
    try {
      const o = actx.createOscillator(), gg = actx.createGain();
      gg.gain.value = 0.0001;
      o.connect(gg); gg.connect(master);
      o.start(); o.stop(actx.currentTime + 0.03);
    } catch (e) {}
  }
}
function out() { return master || (actx && actx.destination); }
function blip(freq, dur, type, vol) {
  if (!actx || muted) return;
  const o = actx.createOscillator(), gg = actx.createGain();
  o.type = type; o.frequency.value = freq;
  const t = actx.currentTime;
  gg.gain.setValueAtTime(0.0001, t);
  gg.gain.linearRampToValueAtTime(vol, t + 0.012);
  gg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(gg); gg.connect(out());
  o.start(t); o.stop(t + dur + 0.02);
}
// 짧은 화이트노이즈 버스트 (BULL '화르륵' 크랙)
function noiseBurst(dur, vol, freq) {
  if (!actx || muted) return;
  const n = Math.floor(actx.sampleRate * dur);
  const buf = actx.createBuffer(1, n, actx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2);
  const src = actx.createBufferSource(); src.buffer = buf;
  const f = actx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq || 1200; f.Q.value = 0.7;
  const gg = actx.createGain(); gg.gain.value = vol;
  src.connect(f); f.connect(gg); gg.connect(out());
  src.start();
}
// 충전음: 부드러운 사인 톤이 살짝 차오른다 (톱니/사각파 버즈 제거)
function startCharge() {
  if (!actx || muted) return;
  chargeOsc = actx.createOscillator();
  chargeGain = actx.createGain();
  chargeOsc.type = 'sine';
  chargeOsc.frequency.value = 220;
  chargeGain.gain.value = 0.0001;
  chargeOsc.connect(chargeGain); chargeGain.connect(out());
  chargeGain.gain.linearRampToValueAtTime(0.04, actx.currentTime + 0.05);
  chargeOsc.start();
}
function setChargePitch(p) {
  if (chargeOsc && actx) { try { chargeOsc.frequency.setTargetAtTime(220 + p * 320, actx.currentTime, 0.02); } catch (e) {} }
}
function stopCharge() {
  if (chargeOsc && actx) {
    const t = actx.currentTime;
    try { chargeGain.gain.cancelScheduledValues(t); chargeGain.gain.setTargetAtTime(0.0001, t, 0.03); chargeOsc.stop(t + 0.14); } catch (e) {}
  }
  chargeOsc = null; chargeGain = null;
}
function playThrow() { blip(430, 0.09, 'sine', 0.10); blip(650, 0.07, 'triangle', 0.05); }
function playHit(val) {
  // 부드러운 '딩' (안쪽 링일수록 높게) — 삼각파 + 옥타브 사인
  const f = val >= 50 ? 740 : val >= 25 ? 587 : val >= 10 ? 494 : 392;
  blip(f, 0.16, 'triangle', 0.16);
  blip(f * 2, 0.11, 'sine', 0.06);
}
function playBull() {
  // 묵직한 쿵 + 부드러운 상승 아르페지오 + 살짝의 화르륵
  blip(70, 0.5, 'sine', 0.32);
  blip(140, 0.34, 'sine', 0.16);
  noiseBurst(0.28, 0.12, 1100);
  [0, 4, 7, 12, 16].forEach(function (st, i) {
    setTimeout(function () { blip(523 * Math.pow(2, st / 12), 0.18, 'triangle', 0.14); }, i * 55);
  });
}
function playMiss() { blip(240, 0.16, 'sine', 0.15); setTimeout(function () { blip(150, 0.34, 'sine', 0.13); }, 70); }
function playFire() { blip(523, 0.14, 'triangle', 0.13); blip(784, 0.20, 'triangle', 0.10); blip(1047, 0.16, 'sine', 0.06); }
function playCool() { blip(440, 0.30, 'sine', 0.13); setTimeout(function () { blip(262, 0.5, 'sine', 0.12); }, 90); }
function playRecord() { [0, 4, 7, 12].forEach(function (st, i) { setTimeout(function () { blip(659 * Math.pow(2, st / 12), 0.16, 'triangle', 0.13); }, i * 70); }); }
function playTension() { blip(98, 0.20, 'sine', 0.18); setTimeout(function () { blip(98, 0.22, 'sine', 0.15); }, 280); }

// ---------- 입력 ----------
function onPress() {
  ensureAudio();
  if ((window.Leaderboard && window.Leaderboard.isOpen()) || (window.Wall && window.Wall.isOpen())) return;
  if (state.mode === 'ready') { startGame(); return; }
  if (state.mode === 'playing' && state.phase === 'aim') {
    state.lockX = currentSweepX(geom());
    state.powPhase = 0;       // 게이지를 바닥부터 차오르게
    state.phaseStartPh = 0;   // 파워 시작 위상(0)부터 바퀴 수 계산
    state.phase = 'power';
    startCharge();
  }
}
function onRelease() {
  if (state.mode === 'playing' && state.phase === 'power') {
    state.lockP = currentP();
    stopCharge();
    launchDart();
  }
}

canvas.addEventListener('pointerdown', function (e) { e.preventDefault(); onPress(); });
window.addEventListener('pointerup', function () { onRelease(); });
window.addEventListener('pointercancel', function () { onRelease(); });
panelStart.addEventListener('pointerdown', function (e) { e.preventDefault(); onPress(); });
window.addEventListener('keydown', function (e) {
  if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
  if (e.repeat) return;
  if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); onPress(); }
});
window.addEventListener('keyup', function (e) {
  if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
  if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); onRelease(); }
});
canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

elMute.addEventListener('pointerdown', function (e) {
  e.preventDefault();
  e.stopPropagation();
  muted = !muted;
  if (muted) stopCharge();
  elMute.textContent = muted ? '🔇' : '🔊';
});

if (elShareBtn) {
  elShareBtn.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    shareScore();
  });
}

// ---------- 최고기록 저장 ----------
function loadBest() {
  try { return parseInt(localStorage.getItem('oneshot_best') || '0', 10) || 0; }
  catch (e) { return 0; }
}
function saveBest(v) {
  try { localStorage.setItem('oneshot_best', String(v)); } catch (e) {}
}

// ---------- 외부(리더보드)에서 사용하는 훅 ----------
window.Oneshot = {
  restart: function () { startGame(); },
  toStart: function () { resetGame(); },
  getScore: function () { return state.score; },
  getBest: function () { return state.best; },
  getDarts: function () { return state.darts; },
  getThrows: function () { return state.throws; },
};

// ---------- 시작 ----------
resize();
resetGame();
requestAnimationFrame(frame);

})();
