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
