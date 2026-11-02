// 일기장 — 화면 파일은 그대로 내주고, /api/pages 만 여기서 처리한다.
// 일기 전체는 { entries: [일기 글, ...] } (맨 앞이 가장 최근 일기) 로 D1 한 줄에 저장한다. 누구나 읽고 쓸 수 있다.
// (처음 버전은 쪽 글 배열 [..] 이었다. 화면이 읽을 때 일기 하나로 합친다)

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname !== '/api/pages') return env.ASSETS.fetch(req);

    await env.DB.prepare('CREATE TABLE IF NOT EXISTS diary (id INTEGER PRIMARY KEY, pages TEXT NOT NULL)').run();

    if (req.method === 'GET') {
      const row = await env.DB.prepare('SELECT pages FROM diary WHERE id = 1').first();
      return new Response(row ? row.pages : '[]', { headers: JSON_HEADERS });
    }

    if (req.method === 'PUT') {
      const body = await req.json().catch(() => null);
      const entries = body && body.entries;
      if (!Array.isArray(entries) || !entries.every((p) => typeof p === 'string')) {
        return new Response('{"error":"bad entries"}', { status: 400, headers: JSON_HEADERS });
      }
      await env.DB.prepare('INSERT INTO diary (id, pages) VALUES (1, ?1) ON CONFLICT(id) DO UPDATE SET pages = ?1')
        .bind(JSON.stringify({ entries }))
        .run();
      return new Response('{"ok":true}', { headers: JSON_HEADERS });
    }

    return new Response('{"error":"method"}', { status: 405, headers: JSON_HEADERS });
  },
};
