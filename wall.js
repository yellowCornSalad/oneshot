'use strict';

/* =========================================================================
 * ONESHOT 익명 게시판 (한 줄 방명록)
 * Supabase REST(dart_messages)에 fetch 로 직접 연동 — 외부 라이브러리 없음.
 *   - 글 목록 : GET  /rest/v1/dart_messages?order=created_at.desc
 *   - 글 등록 : POST /rest/v1/dart_messages
 * RLS 로 읽기/추가만 허용(수정·삭제 불가). anon 키는 공개용이라 안전.
 * 익명 닉네임은 세션마다 랜덤 1개를 받아 그 세션 글에 공통으로 붙인다.
 * ========================================================================= */

(function () {
  const cfg = window.ONESHOT_CONFIG || {};
  const URL = (cfg.SUPABASE_URL || '').replace(/\/+$/, '');
  const KEY = cfg.SUPABASE_ANON_KEY || '';
  const TABLE = 'dart_messages';
  const LIMIT = 30;            // 보여줄 최근 글 수
  const MAXLEN = 80;           // 한 줄 최대 길이
  const COOLDOWN = 3000;       // 연속 등록 쿨다운(ms)
  const ready = !!(URL && KEY && URL.indexOf('YOUR-') === -1 && KEY.indexOf('YOUR-') === -1);

  // ---------- Supabase REST ----------
  function headers(extra) {
    return Object.assign({ apikey: KEY, Authorization: 'Bearer ' + KEY }, extra || {});
  }
  async function fetchMessages() {
    const url = URL + '/rest/v1/' + TABLE + '?select=name,body,created_at&order=created_at.desc&limit=' + LIMIT;
    const res = await fetch(url, { headers: headers() });
    if (!res.ok) throw new Error('fetch failed: ' + res.status);
    return res.json();
  }
  async function postMessage(name, body) {
    const res = await fetch(URL + '/rest/v1/' + TABLE, {
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
      body: JSON.stringify({ name: name, body: body }),
    });
    return res.ok;
  }

  // ---------- 익명 닉네임 (리더보드와 같은 톤) ----------
  const ADJ = ['날쌘', '용감한', '신비한', '거대한', '전설의', '수줍은', '명랑한', '꼼꼼한', '잽싼', '은밀한', '화려한', '강철', '폭주', '무적', '초롱초롱', '느긋한', '엉뚱한', '반짝이는'];
  const ANI = ['다람쥐', '호랑이', '펭귄', '고양이', '부엉이', '여우', '너구리', '수달', '판다', '상어', '매', '코끼리', '두더지', '문어', '햄스터', '거북이', '고슴도치', '알파카'];
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  let _nick = null;
  function nick() { if (!_nick) _nick = pick(ADJ) + pick(ANI) + (Math.floor(Math.random() * 90) + 10); return _nick; }

  // ---------- 위생 처리 ----------
  const BANNED = ['시발', '씨발', 'ㅅㅂ', '병신', 'ㅂㅅ', '개새', 'fuck', 'shit', 'asshole'];
  function clean(s) {
    s = (s || '').replace(/\s+/g, ' ').trim().slice(0, MAXLEN);
    for (const w of BANNED) {
      if (s.toLowerCase().indexOf(w) !== -1) s = s.split(new RegExp(w, 'gi')).join('***');
    }
    return s.slice(0, MAXLEN);
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function timeAgo(iso) {
    const t = new Date(iso).getTime();
    if (isNaN(t)) return '';
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return '방금';
    if (s < 3600) return Math.floor(s / 60) + '분 전';
    if (s < 86400) return Math.floor(s / 3600) + '시간 전';
    return Math.floor(s / 86400) + '일 전';
  }

  // ---------- DOM ----------
  const panelStart = document.getElementById('panel-start');
  const panelOver = document.getElementById('panel-over');
  const panelBoard = document.getElementById('panel-board');
  const panelWall = document.getElementById('panel-wall');
  const wallList = document.getElementById('wall-list');
  const wallInput = document.getElementById('wall-input');
  const sendBtn = document.getElementById('wall-send');
  const wallMsg = document.getElementById('wall-msg');
  const wallClose = document.getElementById('wall-close');
  const startWall = document.getElementById('start-wall');

  let lastPost = 0;

  function setMsg(t) { if (wallMsg) wallMsg.textContent = t || ''; }
  function hideAll() {
    [panelStart, panelOver, panelBoard, panelWall].forEach(function (p) { if (p) p.classList.add('hidden'); });
  }

  function render(rows) {
    if (!rows.length) {
      wallList.innerHTML = '<div class="board-empty">아직 글이 없어요.<br>첫 한 줄을 남겨보세요! ✍️</div>';
      return;
    }
    wallList.innerHTML = rows.map(function (r) {
      return '<div class="wall-row">' +
        '<div class="wall-meta"><span class="wn">' + escapeHtml(r.name) + '</span>' +
        '<span class="wt">' + timeAgo(r.created_at) + '</span></div>' +
        '<div class="wb">' + escapeHtml(r.body) + '</div></div>';
    }).join('');
  }

  async function openWall() {
    hideAll();
    panelWall.classList.remove('hidden');
    setMsg('');
    if (!ready) {
      wallList.innerHTML = '<div class="board-empty">게시판이 아직 설정되지 않았어요.<br><code>supabase-config.js</code> 를 확인해주세요.</div>';
      return;
    }
    wallList.innerHTML = '<div class="board-loading">불러오는 중…</div>';
    try { render(await fetchMessages()); }
    catch (e) { wallList.innerHTML = '<div class="board-empty">불러오기에 실패했어요.<br>네트워크를 확인해주세요.</div>'; }
  }

  async function send() {
    const body = clean(wallInput.value);
    wallInput.value = body;
    if (!body) { setMsg('내용을 입력하세요'); return; }
    if (!ready) { setMsg('게시판이 설정되지 않았어요'); return; }
    const now = Date.now();
    if (now - lastPost < COOLDOWN) { setMsg('잠시 후 다시 시도해주세요'); return; }
    sendBtn.disabled = true;
    setMsg('등록 중…');
    try {
      const ok = await postMessage(nick(), body);
      if (!ok) { setMsg('등록 실패 — 잠시 후 다시 시도해주세요'); sendBtn.disabled = false; return; }
      lastPost = now;
      wallInput.value = '';
      setMsg('');
      render(await fetchMessages());
    } catch (e) {
      setMsg('네트워크 오류 — 다시 시도해주세요');
    }
    sendBtn.disabled = false;
  }

  // ---------- 이벤트 ----------
  if (startWall) {
    startWall.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      e.stopPropagation();   // 시작 패널의 "탭하여 시작"으로 번지지 않게
      openWall();
    });
  }
  if (wallClose) wallClose.addEventListener('click', function () { if (window.Oneshot) window.Oneshot.toStart(); });
  if (sendBtn) sendBtn.addEventListener('click', send);
  if (wallInput) wallInput.addEventListener('keydown', function (e) { if (e.code === 'Enter') { e.preventDefault(); send(); } });

  // ---------- 게임에서 참조하는 훅 ----------
  window.Wall = {
    isOpen: function () { return panelWall && !panelWall.classList.contains('hidden'); },
    open: openWall,
  };
})();
