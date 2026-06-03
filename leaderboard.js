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
  const TABLE = 'dart_scores';
  const ready = !!(URL && KEY && URL.indexOf('YOUR-') === -1 && KEY.indexOf('YOUR-') === -1);

  // ---------- Supabase REST 호출 ----------
  function headers(extra) {
    return Object.assign({ apikey: KEY, Authorization: 'Bearer ' + KEY }, extra || {});
  }
  async function submitScore(name, score) {
    const res = await fetch(URL + '/rest/v1/' + TABLE, {
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
      body: JSON.stringify({ name: name, score: score }),
    });
    return res.ok;
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

  // ---------- 익명 닉네임 ----------
  const ADJ = ['날쌘', '용감한', '신비한', '거대한', '전설의', '수줍은', '명랑한', '꼼꼼한', '잽싼', '은밀한', '화려한', '강철', '폭주', '무적', '초롱초롱', '느긋한', '엉뚱한', '반짝이는'];
  const ANI = ['다람쥐', '호랑이', '펭귄', '고양이', '부엉이', '여우', '너구리', '수달', '판다', '상어', '매', '코끼리', '두더지', '문어', '햄스터', '거북이', '고슴도치', '알파카'];
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function randomName() { return pick(ADJ) + pick(ANI) + (Math.floor(Math.random() * 90) + 10); }
  function loadName() { try { return localStorage.getItem('oneshot_name') || ''; } catch (e) { return ''; } }
  function saveName(n) { try { localStorage.setItem('oneshot_name', n); } catch (e) {} }

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

  function setMsg(t) { submitMsg.textContent = t || ''; }
  function hideAll() {
    panelStart.classList.add('hidden');
    panelOver.classList.add('hidden');
    panelBoard.classList.add('hidden');
  }

  function renderList(rows, mine) {
    if (!rows.length) {
      boardList.innerHTML = '<div class="board-empty">아직 기록이 없어요.<br>첫 1등의 주인공이 되어보세요! 🎯</div>';
      return;
    }
    let hit = false;
    boardList.innerHTML = rows.map(function (r, i) {
      const isMine = mine && !hit && r.name === mine.name && r.score === mine.score;
      if (isMine) hit = true;
      const rk = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '#' + (i + 1);
      return '<div class="board-row' + (isMine ? ' mine' : '') + '">' +
        '<span class="rk">' + rk + '</span>' +
        '<span class="nm">' + escapeHtml(r.name) + '</span>' +
        '<span class="sc">' + r.score + '</span></div>';
    }).join('');
  }

  async function openBoard(mine) {
    hideAll();
    panelBoard.classList.remove('hidden');
    boardMyrank.textContent = mine ? ('내 기록 ' + mine.score + '점' + (mine.rank ? ' · ' + mine.rank + '위' : '')) : '';
    if (!ready) {
      boardList.innerHTML = '<div class="board-empty">리더보드가 아직 설정되지 않았어요.<br><code>supabase-config.js</code> 에 Supabase URL과 anon 키를 넣어주세요.</div>';
      return;
    }
    boardList.innerHTML = '<div class="board-loading">불러오는 중…</div>';
    try { renderList(await topScores(), mine); }
    catch (e) { boardList.innerHTML = '<div class="board-empty">불러오기에 실패했어요.<br>네트워크 또는 설정을 확인해주세요.</div>'; }
  }

  // ---------- 이벤트 ----------
  submitBtn.addEventListener('click', async function () {
    const name = clean(nameInput.value);
    nameInput.value = name;
    saveName(name);
    const score = window.Oneshot ? window.Oneshot.getScore() : 0;
    if (!ready) { openBoard({ name: name, score: score, rank: null }); return; }
    submitBtn.disabled = true;
    setMsg('등록 중…');
    try {
      const ok = await submitScore(name, score);
      if (!ok) { setMsg('등록 실패 — 잠시 후 다시 시도해주세요'); submitBtn.disabled = false; return; }
      let rank = null;
      try { rank = await rankOf(score); } catch (e) {}
      openBoard({ name: name, score: score, rank: rank });
    } catch (e) {
      setMsg('네트워크 오류 — 다시 시도해주세요');
      submitBtn.disabled = false;
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
    onOver: function () {
      nameInput.value = loadName() || randomName();
      submitBtn.disabled = false;
      setMsg('');
    },
    open: openBoard,
  };
})();
