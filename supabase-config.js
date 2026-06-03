/* ONESHOT 리더보드 설정
 * ──────────────────────────────────────────────────────────────
 * 아래 두 값을 본인 Supabase 프로젝트 값으로 바꾸세요.
 *   - SUPABASE_URL      : 프로젝트 URL  (예: https://abcd1234.supabase.co)
 *   - SUPABASE_ANON_KEY : 'anon' 'public' 키 (클라이언트에 넣어도 안전한 공개 키)
 *
 * 위치: Supabase 대시보드 → Project Settings → API
 *   • Project URL          → SUPABASE_URL
 *   • Project API keys: anon public → SUPABASE_ANON_KEY
 *
 * 💡 Skystack과 같은 Supabase 프로젝트를 그대로 재사용해도 됩니다.
 *    이 게임은 별도 테이블(dart_scores)을 쓰므로 점수가 섞이지 않습니다.
 *    (supabase/schema.sql 을 SQL Editor 에서 한 번 실행하세요)
 *
 * ⚠️ 'service_role' 키(secret)는 절대 여기에 넣지 마세요. 서버 전용 비밀키입니다.
 * 값을 넣기 전까지는 게임은 정상 동작하고, 리더보드만 "미설정" 으로 표시됩니다.
 */
window.ONESHOT_CONFIG = {
  SUPABASE_URL: 'https://kfacyujmcriydkesitzf.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtmYWN5dWptY3JpeWRrZXNpdHpmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0ODY3MTEsImV4cCI6MjA5NjA2MjcxMX0.Uqy1RC527ZKSUJBt7R43zNMvE7SUfQIR_-lKoymN9TQ',
  LEADERBOARD_LIMIT: 100,
};
