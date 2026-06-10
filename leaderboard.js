'use strict';

/* =========================================================================
 * ONESHOT 리더보드
 * Supabase REST(PostgREST)에 fetch 로 직접 연동 — 외부 라이브러리/빌드 없음.
 *   - 점수 등록 : POST  /rest/v1/dart_scores
 *   - 순위 목록 : GET   /rest/v1/dart_scores?order=score.desc
 *   - 내 순위   : GET   ?score=gt.<내점수>  + Prefer:count=exact 의 Content-Range
 * 보안은 Supabase RLS 정책으로 처리(읽기/추가만 허용). anon 키는 공개용이라 안전.
 * ========================================================================= */

(function () {
  const cfg = window.ONESHOT_CONFIG || {};
  const URL = (cfg.SUPABASE_URL || '').replace(/\/+$/, '');
  const KEY = cfg.SUPABASE_ANON_KEY || '';
  const LIMIT = cfg.LEADERBOARD_LIMIT || 100;
  const TOP_N = 20;                 // 메인 목록에 보여줄 상위 인원 수
  const CELEBRATE_AT = 10000;       // 이 점수 돌파 시 축하 띠지(복권 당첨 느낌)
  const TABLE = 'dart_scores';
  const ready = !!(URL && KEY && URL.indexOf('YOUR-') === -1 && KEY.indexOf('YOUR-') === -1);

  // ---------- Supabase REST 호출 ----------
  function headers(extra) {
    return Object.assign({ apikey: KEY, Authorization: 'Bearer ' + KEY }, extra || {});
  }
  // 서버 검증용 1회용 플레이 토큰(게임 시작 때 발급받음)
  let playToken = null;
  async function fetchToken() {
    playToken = null;
    if (!ready) return;
    try {
      const res = await fetch(URL + '/rest/v1/rpc/start_dart_session', {
        method: 'POST', headers: headers({ 'Content-Type': 'application/json' }), body: '{}',
      });
      if (res.ok) { const t = await res.json(); if (typeof t === 'string') playToken = t; }
    } catch (e) {}
  }
  // 점수 제출 → 서버 함수가 토큰 서명·경과시간·타당성 검증 후 삽입.
  // 'ok' 또는 거부 사유(bad_sig/implausible/too_fast/used/…) 또는 'network' 반환.
  async function submitScore(name, score) {
    try {
      const res = await fetch(URL + '/rest/v1/rpc/submit_dart_score', {
        method: 'POST',
        headers: headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ p_token: playToken || '', p_name: name, p_score: score }),
      });
      if (!res.ok) return 'network';
      const r = await res.json();
      return typeof r === 'string' ? r : 'network';
    } catch (e) { return 'network'; }
  }
  async function topScores(limit) {
    const url = URL + '/rest/v1/' + TABLE + '?select=name,score&order=score.desc,created_at.asc&limit=' + (limit || LIMIT);
    const res = await fetch(url, { headers: headers() });
    if (!res.ok) throw new Error('fetch failed: ' + res.status);
    return res.json();
  }
  async function rankOf(score) {
    const url = URL + '/rest/v1/' + TABLE + '?select=id&score=gt.' + encodeURIComponent(score);
    const res = await fetch(url, { headers: headers({ Prefer: 'count=exact', Range: '0-0' }) });
    const cr = res.headers.get('content-range'); // "0-0/<total>" 형태
    if (!cr) return null;
    const total = parseInt(cr.split('/')[1], 10);
    return isNaN(total) ? null : total + 1; // 나보다 높은 점수 수 + 1
  }

  // 내 점수 기준 바로 위(더 높은 점수)·아래(더 낮은 점수)에서 가장 가까운 사람
  async function neighborAbove(score) {
    const url = URL + '/rest/v1/' + TABLE + '?select=name,score&score=gt.' + encodeURIComponent(score) + '&order=score.asc&limit=1';
    const res = await fetch(url, { headers: headers() });
    if (!res.ok) return null;
    const rows = await res.json();
    return rows[0] || null;
  }
  async function neighborBelow(score) {
    const url = URL + '/rest/v1/' + TABLE + '?select=name,score&score=lt.' + encodeURIComponent(score) + '&order=score.desc&limit=1';
    const res = await fetch(url, { headers: headers() });
    if (!res.ok) return null;
    const rows = await res.json();
    return rows[0] || null;
  }

  // ---------- 익명 닉네임 ----------
  const ADJ = ['날쌘', '용감한', '신비한', '거대한', '전설의', '수줍은', '명랑한', '꼼꼼한', '잽싼', '은밀한', '화려한', '강철', '폭주', '무적', '초롱초롱', '느긋한', '엉뚱한', '반짝이는'];
  const ANI = ['다람쥐', '호랑이', '펭귄', '고양이', '부엉이', '여우', '너구리', '수달', '판다', '상어', '매', '코끼리', '두더지', '문어', '햄스터', '거북이', '고슴도치', '알파카'];
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function randomName() { return pick(ADJ) + pick(ANI) + (Math.floor(Math.random() * 90) + 10); }

  // 가벼운 욕설 가드 (사내용 — 완벽하진 않음)
  const BANNED = ['시발', '씨발', 'ㅅㅂ', '병신', 'ㅂㅅ', '개새', 'fuck', 'shit', 'asshole'];
  function clean(s) {
    s = (s || '').trim().replace(/\s+/g, ' ').slice(0, 20);
    if (!s) return randomName();
    for (const w of BANNED) {
      if (s.toLowerCase().indexOf(w) !== -1) s = s.split(new RegExp(w, 'gi')).join('***');
    }
    return s.slice(0, 20);
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---------- DOM ----------
  const panelStart = document.getElementById('panel-start');
  const panelOver = document.getElementById('panel-over');
  const panelBoard = document.getElementById('panel-board');
  const nameInput = document.getElementById('name-input');
  const submitBtn = document.getElementById('over-submit');
  const overAgain = document.getElementById('over-again');
  const submitMsg = document.getElementById('submit-msg');
  const startBoardBtn = document.getElementById('start-board');
  const boardAgain = document.getElementById('board-again');
  const boardClose = document.getElementById('board-close');
  const boardList = document.getElementById('board-list');
  const boardMyrank = document.getElementById('board-myrank');
  const boardCelebrate = document.getElementById('board-celebrate');

  function setMsg(t) { submitMsg.textContent = t || ''; }
  function hideAll() {
    panelStart.classList.add('hidden');
    panelOver.classList.add('hidden');
    panelBoard.classList.add('hidden');
  }

  function rankBadge(rank) {
    return rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '#' + rank;
  }
  function rowHtml(rank, r, isMine) {
    return '<div class="board-row' + (isMine ? ' mine' : '') + '">' +
      '<span class="rk">' + rankBadge(rank) + '</span>' +
      '<span class="nm">' + escapeHtml(r.name) + '</span>' +
      '<span class="sc">' + r.score + '</span></div>';
  }
  // 상위 TOP_N 목록 + (내가 그 밖이면) 내 앞/나/뒤 블록
  function renderBoard(top, mine, pos) {
    if (!top.length) {
      boardList.innerHTML = '<div class="board-empty">아직 기록이 없어요.<br>첫 1등의 주인공이 되어보세요! 🎯</div>';
      return;
    }
    const inTop = !!(mine && mine.rank && mine.rank <= TOP_N);
    let hit = false;
    let html = top.map(function (r, i) {
      const isMine = inTop && !hit && r.name === mine.name && r.score === mine.score;
      if (isMine) hit = true;
      return rowHtml(i + 1, r, isMine);
    }).join('');
    if (pos) { // 내가 TOP_N 밖 → 내 앞 / 나 / 뒤
      html += '<div class="board-gap">⋯</div>';
      if (pos.above) html += rowHtml(pos.aRank, pos.above, false);
      html += rowHtml(mine.rank, { name: mine.name, score: mine.score }, true);
      if (pos.below) html += rowHtml(pos.bRank, pos.below, false);
    }
    boardList.innerHTML = html;
  }

  // 🎉 1만점 돌파자 축하 띠지 (복권 당첨 현수막 느낌 — 금색 마퀴)
  function renderCelebrate(rows) {
    if (!boardCelebrate) return;
    const winners = rows.filter(function (r) { return r.score >= CELEBRATE_AT; });
    if (!winners.length) { boardCelebrate.classList.add('hidden'); boardCelebrate.innerHTML = ''; return; }
    const sep = '   ✦   ';
    const line = winners.map(function (w) {
      return '🎊 ' + escapeHtml(w.name) + '님 ' + w.score.toLocaleString() + '점 돌파 축하드립니다! 🎉';
    }).join(sep);
    // 끊김 없는 마퀴를 위해 같은 내용을 두 번 이어붙임
    boardCelebrate.innerHTML = '<div class="celebrate-track">' + line + sep + line + sep + '</div>';
    boardCelebrate.classList.remove('hidden');
  }

  async function openBoard(mine) {
    hideAll();
    panelBoard.classList.remove('hidden');
    boardMyrank.textContent = (mine && mine.score != null)
      ? ('내 기록: ' + mine.score + '점' + (mine.rank ? ' · ' + mine.rank + '위' : ''))
      : '';
    if (boardCelebrate) boardCelebrate.classList.add('hidden');   // 기본 숨김
    if (!ready) {
      boardList.innerHTML = '<div class="board-empty">리더보드가 아직 설정되지 않았어요.<br><code>supabase-config.js</code> 에 Supabase URL과 anon 키를 넣어주세요.</div>';
      return;
    }
    boardList.innerHTML = '<div class="board-loading">불러오는 중…</div>';
    try {
      const top = await topScores(TOP_N);
      renderCelebrate(top);   // 🎉 1만점 돌파자 축하 띠지
      let pos = null;
      // 내가 상위 20위 밖이면 내 앞/뒤 사람을 따로 불러온다
      if (mine && typeof mine.rank === 'number' && mine.rank > TOP_N) {
        const above = await neighborAbove(mine.score);
        const below = await neighborBelow(mine.score);
        const aRank = above ? await rankOf(above.score) : null;
        const bRank = below ? await rankOf(below.score) : null;
        pos = { above: above, below: below, aRank: aRank, bRank: bRank };
      }
      renderBoard(top, mine, pos);
    } catch (e) {
      boardList.innerHTML = '<div class="board-empty">불러오기에 실패했어요.<br>네트워크 또는 설정을 확인해주세요.</div>';
    }
  }

  // ---------- 이벤트 ----------
  submitBtn.addEventListener('click', async function () {
    const name = clean(nameInput.value);
    nameInput.value = name;
    const score = window.Oneshot ? window.Oneshot.getScore() : 0;
    if (!ready) { openBoard({ name: name, score: score, rank: null }); return; }
    if (!playToken) { setMsg('연결 문제로 등록할 수 없어요. 새로고침 후 다시 시도해주세요.'); return; }
    submitBtn.disabled = true;
    setMsg('등록 중…');
    let result;
    try { result = await submitScore(name, score); } catch (e) { result = 'network'; }
    if (result === 'ok') {
      let rank = null;
      try { rank = await rankOf(score); } catch (e) {}
      openBoard({ name: name, score: score, rank: rank });
    } else if (result === 'network') {
      setMsg('네트워크 오류 — 다시 시도해주세요'); submitBtn.disabled = false;
    } else {
      // 서버 검증 거부 → 비정상 접근/점수
      setMsg('⚠️ 비정상 점수로 판단되어 랭킹에 반영되지 않았어요'); submitBtn.disabled = false;
    }
  });

  overAgain.addEventListener('click', function () { if (window.Oneshot) window.Oneshot.restart(); });
  boardAgain.addEventListener('click', function () { if (window.Oneshot) window.Oneshot.restart(); });
  boardClose.addEventListener('click', function () { if (window.Oneshot) window.Oneshot.toStart(); });

  nameInput.addEventListener('keydown', function (e) {
    if (e.code === 'Enter') { e.preventDefault(); submitBtn.click(); }
  });

  // 시작화면의 리더보드 버튼: 시작 패널의 "탭하여 시작"으로 번지지 않게 차단
  startBoardBtn.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    e.stopPropagation();
    openBoard(null);
  });

  // 게임 도중 우상단 🏆 버튼: 플레이 중에도 랭킹을 볼 수 있게
  const inGameBoardBtn = document.getElementById('board-btn');
  if (inGameBoardBtn) {
    inGameBoardBtn.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      e.stopPropagation();   // 캔버스 던지기 입력으로 번지지 않게
      openBoard(null);
    });
  }

  // ---------- 게임(game.js)에서 호출하는 훅 ----------
  window.Leaderboard = {
    ready: ready,
    isOpen: function () { return !panelBoard.classList.contains('hidden'); },
    onStart: function () { fetchToken(); },   // 게임 시작 시 서버에서 플레이 토큰 발급
    onOver: function () {
      nameInput.value = randomName();   // 매 게임오버마다 새 랜덤 닉네임
      submitBtn.disabled = false;
      setMsg('');
    },
    open: openBoard,
  };
})();
