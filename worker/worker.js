// Proxy between the GitHub Pages UI and dinbendon's internal JSON API, acting as the group account.
// Holds the group account's JWT in KV (seeded by the admin; never a password), injects it upstream,
// and saves refreshed tokens dinbendon returns in `x-dbd-new-token`.
const UPSTREAM = 'https://www.dinbendon.net/mvc/api';
const ID = '[A-Za-z0-9]{6,20}';
// [method, path regex, role]. Anything else is rejected.
const ROUTES = [
  ['GET', /^\/order\/progress$/, 'user'],
  ['POST', new RegExp(`^/order/${ID}/get-add-item$`), 'user'],
  ['GET', new RegExp(`^/order/${ID}/expand-for-buyer$`), 'user'],
  ['POST', new RegExp(`^/order/${ID}/add-item$`), 'user'],
  ['POST', new RegExp(`^/order/${ID}/cancel-item$`), 'user'],
  ['GET', /^\/shop\/available-shops$/, 'admin'],
  ['POST', /^\/order\/create$/, 'admin'],
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !b) return false;
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

function jwtExp(token) {
  try { return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp * 1000; } catch { return 0; }
}

async function upstream(env, method, path, { body, ownerKey } = {}) {
  const jwt = await env.KV.get('jwt');
  if (!jwt) return new Response(JSON.stringify({ error: '尚未設定 dinbendon token，請管理員到「開團」頁設定' }), { status: 503 });
  const headers = { Authorization: `Bearer ${jwt}`, Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (ownerKey) headers['X-DBD-Owner-Key'] = ownerKey;
  const res = await fetch(UPSTREAM + path, { method, headers, body });
  const fresh = res.headers.get('x-dbd-new-token');
  if (fresh && fresh !== jwt) await env.KV.put('jwt', fresh);
  return res;
}

export default {
  async fetch(request, env) {
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    const origin = request.headers.get('Origin') || '';
    if (!allowed.includes(origin)) return new Response('forbidden origin', { status: 403 });
    const cors = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Access-Code, X-Admin-Code, X-Owner-Key',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
    };
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const isAdmin = same(request.headers.get('X-Admin-Code') || '', env.ADMIN_CODE);
    const isUser = isAdmin || same(request.headers.get('X-Access-Code') || '', env.ACCESS_CODE);
    if (!isUser) return json({ error: '通關碼錯誤' }, 401);

    const path = new URL(request.url).pathname;

    // Admin: check / replace the stored group-account token.
    if (path === '/_token') {
      if (!isAdmin) return json({ error: '需要管理碼' }, 403);
      if (request.method === 'POST') {
        const { token } = await request.json().catch(() => ({}));
        if (typeof token !== 'string' || jwtExp(token) < Date.now()) return json({ error: 'token 格式錯誤或已過期' }, 400);
        await env.KV.put('jwt', token);
      }
      const jwt = await env.KV.get('jwt');
      return json({ data: { exp: jwt ? jwtExp(jwt) : null } });
    }

    const route = ROUTES.find(([m, re]) => m === request.method && re.test(path));
    if (!route) return json({ error: 'not found' }, 404);
    if (route[2] === 'admin' && !isAdmin) return json({ error: '需要管理碼' }, 403);

    const ownerKey = request.headers.get('X-Owner-Key') || '';
    const res = await upstream(env, request.method, path, {
      body: request.method === 'POST' ? await request.text() : undefined,
      ownerKey: UUID.test(ownerKey) ? ownerKey : undefined,
    });
    return new Response(res.body, { status: res.status, headers: { ...cors, 'Content-Type': res.headers.get('Content-Type') || 'application/json' } });
  },

  // Daily ping so dinbendon can hand back a refreshed token before the 30-day expiry.
  async scheduled(event, env) {
    await upstream(env, 'POST', '/auth/auth-login');
  },
};
