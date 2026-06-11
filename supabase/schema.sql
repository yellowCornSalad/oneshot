-- ONESHOT 리더보드 스키마
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 [Run] 하세요. (한 번만 실행)
-- Skystack과 같은 프로젝트를 재사용해도 됩니다 — 테이블명이 dart_scores 로 분리돼 있습니다.

-- 1) 점수 테이블
create table if not exists public.dart_scores (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 20),
  score       integer not null check (score >= 0 and score <= 10000000),
  created_at  timestamptz not null default now(),
  elapsed_ms  bigint,                                  -- 토큰 발급~제출 경과(서버 측정, 위조 탐지용)
  throws      int,                                     -- 던진 횟수(클라 보고, 검토 참고용)
  auto_flag   boolean not null default false,          -- 사람이 낼 수 없는 패턴 → 축하 띠지에서 격리
  verified    boolean not null default false           -- 상품(치킨) 지급은 사람이 확인 후 이 값을 true 로
);
-- 기존 테이블에 컬럼 추가(이미 만들어진 경우):
alter table public.dart_scores
  add column if not exists elapsed_ms bigint,
  add column if not exists throws int,
  add column if not exists auto_flag boolean not null default false,
  add column if not exists verified boolean not null default false;

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

drop function if exists public.submit_dart_score(text, text, int);
create or replace function public.submit_dart_score(p_token text, p_name text, p_score int, p_throws int default null)
returns text language plpgsql security definer set search_path = public, extensions as $fn$
declare parts text[]; sid uuid; iat bigint; sig text; secret text; expect text;
        elapsed_ms bigint; max_pps int := 2000; abs_cap int := 500000; nm text; v_flag boolean := false;
begin
  parts := string_to_array(coalesce(p_token,''), ':');
  if coalesce(array_length(parts,1),0) <> 3 then return 'bad_token'; end if;
  begin sid := parts[1]::uuid; iat := parts[2]::bigint; exception when others then return 'bad_token'; end;
  sig := parts[3];
  select v into secret from public.dart_secret where k='hmac';
  expect := encode(extensions.hmac(parts[1]||':'||parts[2], secret, 'sha256'),'hex');
  if sig <> expect then return 'bad_sig'; end if;                 -- 토큰 위조
  -- 토큰을 서명검증 직후 즉시 소모 → 실패 시도로 경계값을 탐색하는 공격 차단(거부돼도 토큰 소멸)
  begin insert into public.dart_used(session_id) values (sid);
  exception when unique_violation then return 'used'; end;        -- 재사용 방지
  elapsed_ms := (extract(epoch from now())*1000)::bigint - iat;
  if elapsed_ms < 1500 then return 'too_fast'; end if;            -- 즉시 제출 차단
  if elapsed_ms > 10800000 then return 'expired'; end if;          -- 3시간(긴 정밀 플레이 허용)
  if p_score < 0 or p_score > abs_cap then return 'implausible'; end if;            -- 절대 상한 50만(정상 고득점 5만+도 허용)
  if p_score > (max_pps * (elapsed_ms/1000.0)) then return 'implausible'; end if;   -- 초당 2000점(즉시 위조만 차단)
  -- 자동 의심 플래그: 던지기 수로도 물리적으로 불가능한 점수만(한 발 최대 2400점). 정상 실력 플레이는 절대 안 걸림.
  -- (점수 크기·속도 기반 플래그는 정상 고득점 5만+를 오판해 제거 — 상품은 verified 사람확인으로 보호)
  if p_score >= 10000 and p_throws is not null and p_throws > 0 and p_score > p_throws * 2400 then
    v_flag := true;
  end if;
  nm := left(regexp_replace(coalesce(btrim(p_name),''), '[[:cntrl:]<>]', '', 'g'), 20);  -- 서버측 위생(제어문자·<> 제거)
  if nm = '' then nm := '익명'; end if;
  insert into public.dart_scores(name, score, elapsed_ms, throws, auto_flag)
    values (nm, p_score, elapsed_ms, p_throws, v_flag);
  return 'ok';
end $fn$;

grant execute on function public.start_dart_session() to anon;
grant execute on function public.submit_dart_score(text, text, int, int) to anon;


-- ──────────────────────────────────────────────────────────────
-- 닉네임별 최고점 뷰 — 리더보드/축하 띠지는 사람당 1개(최고점)만 표시
create or replace view public.dart_best_scores
with (security_invoker = on) as
select distinct on (name) name, score, created_at
from public.dart_scores
where auto_flag = false                 -- 자동 의심 플래그된 위조 의심 점수는 축하 띠지에서 제외
order by name, score desc, created_at asc;
grant select on public.dart_best_scores to anon;


-- ──────────────────────────────────────────────────────────────
-- 상품(치킨) 지급 검토용 쿼리 (대시보드 SQL Editor에서 사람이 직접 실행)
--   클라이언트 게임은 점수 위조를 100% 막을 수 없으므로, 상품은 "사람 확인 후 지급"이 유일한 확실한 방어다.
--
-- 1) 1만점+ 후보 검토(의심 신호 같이 보기): auto_flag=true 거나 elapsed/throws 가 어색하면 가짜 가능성↑
--   select name, score, elapsed_ms, throws, auto_flag, verified, created_at
--     from public.dart_scores where score >= 10000 order by created_at desc;
-- 2) 진짜 우승자로 확인되면 지급 대상으로 표시:
--   update public.dart_scores set verified = true where id = '<해당 행 id>';
-- 3) 실제 지급 대상(사람이 확인한 우승자)만:
--   select name, max(score) as score from public.dart_scores
--     where verified = true group by name order by score desc;
