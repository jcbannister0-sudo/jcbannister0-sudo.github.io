// VEBL Cloudflare Worker API — global dynamic user rarity + live feedback
// Deploy with Wrangler (`wrangler deploy`) after creating KV namespace `VEBL_KV`.

function corsHeaders(req, env) {
  const origin = req.headers.get('Origin') || '';
  const raw = env.ALLOWED_ORIGINS || 'https://vebl.me,https://www.vebl.me,https://jcbannister0-sudo.github.io';
  const allowed = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const allow = allowed.includes(origin) ? origin : allowed[0] || '*';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin'
  };
}

function json(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors }
  });
}

const VALID_ID = /^[a-z0-9\-]{2,64}$/;

export default {
  async fetch(req, env) {
    const cors = corsHeaders(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (!env.VEBL_KV) return json({ error: 'VEBL_KV binding not configured' }, 500, cors);

    const url = new URL(req.url);

    // 1. GET /api/stats?ids=id1,id2,...
    if (req.method === 'GET' && url.pathname === '/api/stats') {
      const ids = (url.searchParams.get('ids') || '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => VALID_ID.test(s))
        .slice(0, 14);
      const stats = {};
      await Promise.all(
        ids.map(async (id) => {
          const val = await env.VEBL_KV.get(`stats:${id}`, 'json');
          if (val) stats[id] = val;
        })
      );
      return json({ stats }, 200, cors);
    }

    // 2. POST /api/play -> records accepted answer frequencies & unmatched guesses
    if (req.method === 'POST' && url.pathname === '/api/play') {
      let body;
      try {
        body = await req.json();
      } catch {
        return json({ error: 'Invalid JSON' }, 400, cors);
      }
      const promptId = String(body?.promptId || '').trim();
      if (!VALID_ID.test(promptId)) return json({ error: 'Invalid promptId' }, 400, cors);

      if (body.accepted && body.answer) {
        const answer = String(body.answer).trim().slice(0, 100);
        if (!answer) return json({ error: 'Empty answer' }, 400, cors);
        const key = `stats:${promptId}`;
        const cur = (await env.VEBL_KV.get(key, 'json')) || { total: 0, counts: {} };
        cur.total = (cur.total || 0) + 1;
        cur.counts = cur.counts || {};
        cur.counts[answer] = (cur.counts[answer] || 0) + 1;
        await env.VEBL_KV.put(key, JSON.stringify(cur));
        return json({ ok: true, total: cur.total, count: cur.counts[answer] }, 200, cors);
      }

      if (body.raw) {
        const raw = String(body.raw).trim().slice(0, 80);
        if (raw) {
          const mKey = `misses:${promptId}`;
          const m = (await env.VEBL_KV.get(mKey, 'json')) || { items: {} };
          m.items[raw] = (m.items[raw] || 0) + 1;
          const entries = Object.entries(m.items)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 200);
          m.items = Object.fromEntries(entries);
          await env.VEBL_KV.put(mKey, JSON.stringify(m));
        }
      }
      return json({ ok: true }, 200, cors);
    }

    // 3. POST /api/feedback -> stores feedback & optionally notifies webhook
    if (req.method === 'POST' && url.pathname === '/api/feedback') {
      let body;
      try {
        body = await req.json();
      } catch {
        return json({ error: 'Invalid JSON' }, 400, cors);
      }
      const entry = {
        rating: Number.isInteger(body?.rating) && body.rating >= 1 && body.rating <= 5 ? body.rating : null,
        kind: String(body?.kind || 'General').slice(0, 32),
        promptId: String(body?.promptId || 'general').slice(0, 64),
        missingAnswer: String(body?.missingAnswer || '').trim().slice(0, 100),
        message: String(body?.message || '').trim().slice(0, 800),
        score: Number.isFinite(body?.score) ? body.score : null,
        alt: Number.isFinite(body?.alt) ? body.alt : null,
        mode: String(body?.mode || '').slice(0, 24),
        dayKey: String(body?.dayKey || '').slice(0, 24),
        ts: new Date().toISOString()
      };
      if (!entry.rating && !entry.missingAnswer && !entry.message) {
        return json({ error: 'Empty feedback' }, 400, cors);
      }
      const fbKey = `fb:${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      await env.VEBL_KV.put(fbKey, JSON.stringify(entry));

      const idx = (await env.VEBL_KV.get('fb:index', 'json')) || [];
      idx.unshift(fbKey);
      await env.VEBL_KV.put('fb:index', JSON.stringify(idx.slice(0, 500)));

      if (env.FEEDBACK_WEBHOOK_URL) {
        const text = `📊 VEBL Feedback [${entry.kind}]${entry.rating ? ` ${entry.rating}★` : ''} (${entry.promptId})\nMissing: ${entry.missingAnswer || '—'}\nNote: ${entry.message || '—'}`;
        await fetch(env.FEEDBACK_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: text, text })
        }).catch(() => {});
      }
      return json({ ok: true, id: fbKey }, 200, cors);
    }

    // 4. GET /api/admin/export (protected by ADMIN_TOKEN secret)
    if (req.method === 'GET' && url.pathname === '/api/admin/export') {
      const auth = req.headers.get('Authorization') || '';
      if (!env.ADMIN_TOKEN || auth !== `Bearer ${env.ADMIN_TOKEN}`) {
        return json({ error: 'Unauthorized' }, 401, cors);
      }
      const idx = (await env.VEBL_KV.get('fb:index', 'json')) || [];
      const feedback = (
        await Promise.all(idx.slice(0, 100).map((k) => env.VEBL_KV.get(k, 'json')))
      ).filter(Boolean);
      const list = await env.VEBL_KV.list({ prefix: 'misses:', limit: 100 });
      const misses = {};
      await Promise.all(
        list.keys.map(async (k) => {
          misses[k.name.slice(7)] = await env.VEBL_KV.get(k.name, 'json');
        })
      );
      return json({ feedback, misses }, 200, cors);
    }

    return json({ error: 'Not found' }, 404, cors);
  }
};
