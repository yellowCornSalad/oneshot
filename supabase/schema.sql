-- ONESHOT 리더보드 스키마
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 [Run] 하세요. (한 번만 실행)
-- Skystack과 같은 프로젝트를 재사용해도 됩니다 — 테이블명이 dart_scores 로 분리돼 있습니다.

-- 1) 점수 테이블
create table if not exists public.dart_scores (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 20),
  score       integer not null check (score >= 0 and score <= 10000000),
  created_at  timestamptz not null default now()
);

-- 정렬 성능용 인덱스 (점수 내림차순 조회)
create index if not exists dart_scores_score_idx on public.dart_scores (score desc, created_at asc);

-- 2) RLS(행 수준 보안) 활성화
alter table public.dart_scores enable row level security;

-- 3) 정책: 누구나(anon) 읽기 허용
drop policy if exists "anyone can read dart_scores" on public.dart_scores;
create policy "anyone can read dart_scores"
  on public.dart_scores
  for select
  to anon
  using (true);

-- 4) 정책: 누구나(anon) 추가 허용 (값 범위는 위 CHECK 제약으로 제한)
drop policy if exists "anyone can insert dart_scores" on public.dart_scores;
create policy "anyone can insert dart_scores"
  on public.dart_scores
  for insert
  to anon
  with check (
    char_length(name) between 1 and 20
    and score >= 0 and score <= 10000000
  );

-- update / delete 정책은 만들지 않음 → anon 키로는 기존 기록 변조·삭제 불가.
--
-- 참고: 클라이언트 게임 특성상 점수 자체의 위조를 100% 막을 수는 없습니다.
-- (사내 재미용으로는 충분. 강한 검증이 필요하면 서버측 점수 검증을 추가해야 함)


-- ──────────────────────────────────────────────────────────────
-- 익명 게시판(한 줄 방명록) 테이블
create table if not exists public.dart_messages (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 20),
  body        text not null check (char_length(body) between 1 and 100),
  created_at  timestamptz not null default now()
);
create index if not exists dart_messages_created_idx on public.dart_messages (created_at desc);

alter table public.dart_messages enable row level security;

drop policy if exists "anyone can read dart_messages" on public.dart_messages;
create policy "anyone can read dart_messages"
  on public.dart_messages for select to anon using (true);

drop policy if exists "anyone can insert dart_messages" on public.dart_messages;
create policy "anyone can insert dart_messages"
  on public.dart_messages for insert to anon
  with check (char_length(name) between 1 and 20 and char_length(body) between 1 and 100);
-- update/delete 정책 없음 → anon 키로 기존 글 수정·삭제 불가.


-- ──────────────────────────────────────────────────────────────
-- 서버측 점수 검증 (치팅 방어)
-- anon 의 dart_scores 직접 INSERT 를 막고, 점수는 아래 함수로만 등록된다.
--   1) 게임 시작 시 start_dart_session() → 서명된 1회용 토큰 발급
--   2) 제출 시 submit_dart_score() → 토큰 서명·경과시간·타당성·재사용 검증 후 삽입
-- ──────────────────────────────────────────────────────────────
create extension if not exists pgcrypto with schema extensions;

-- 직접 INSERT 차단(읽기만 남김) — 등록은 submit_dart_score() 로만
drop policy if exists "anyone can insert dart_scores" on public.dart_scores;

-- HMAC 비밀키(anon 접근 차단)
create table if not exists public.dart_secret (k text primary key, v text not null);
alter table public.dart_secret enable row level security;
revoke all on public.dart_secret from anon, authenticated;
insert into public.dart_secret(k, v)
  values ('hmac', encode(extensions.gen_random_bytes(32), 'hex'))
  on conflict (k) do nothing;

-- 사용된 토큰(재사용 방지)
create table if not exists public.dart_used (session_id uuid primary key, used_at timestamptz not null default now());
alter table public.dart_used enable row level security;
revoke all on public.dart_used from anon, authenticated;

create or replace function public.start_dart_session()
returns text language plpgsql security definer set search_path = public, extensions as $fn$
declare sid uuid := gen_random_uuid();
        iat bigint := (extract(epoch from now())*1000)::bigint;
        secret text; payload text;
begin
  select v into secret from public.dart_secret where k='hmac';
  payload := sid::text || ':' || iat::text;
  return payload || ':' || encode(extensions.hmac(payload, secret, 'sha256'),'hex');
end $fn$;

create or replace function public.submit_dart_score(p_token text, p_name text, p_score int)
returns text language plpgsql security definer set search_path = public, extensions as $fn$
declare parts text[]; sid uuid; iat bigint; sig text; secret text; expect text;
        elapsed_ms bigint; max_pps int := 500; nm text;
begin
  parts := string_to_array(coalesce(p_token,''), ':');
  if coalesce(array_length(parts,1),0) <> 3 then return 'bad_token'; end if;
  begin sid := parts[1]::uuid; iat := parts[2]::bigint; exception when others then return 'bad_token'; end;
  sig := parts[3];
  select v into secret from public.dart_secret where k='hmac';
  expect := encode(extensions.hmac(parts[1]||':'||parts[2], secret, 'sha256'),'hex');
  if sig <> expect then return 'bad_sig'; end if;                 -- 토큰 위조
  elapsed_ms := (extract(epoch from now())*1000)::bigint - iat;
  if elapsed_ms < 1500 then return 'too_fast'; end if;            -- 즉시 제출 차단
  if elapsed_ms > 3600000 then return 'expired'; end if;
  if p_score < 0 or p_score > 10000000 then return 'bad_score'; end if;
  if p_score > (max_pps * (elapsed_ms/1000.0)) then return 'implausible'; end if;  -- 시간당 타당성
  begin insert into public.dart_used(session_id) values (sid);
  exception when unique_violation then return 'used'; end;        -- 재사용 방지
  nm := left(coalesce(nullif(btrim(p_name),''),'익명'), 20);
  insert into public.dart_scores(name, score) values (nm, p_score);
  return 'ok';
end $fn$;

grant execute on function public.start_dart_session() to anon;
grant execute on function public.submit_dart_score(text, text, int) to anon;
