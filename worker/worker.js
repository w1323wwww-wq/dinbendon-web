// Proxy between the GitHub Pages UI and dinbendon's internal JSON API, acting as the group account.
// Holds the group account's JWT in KV (seeded by the admin; never a password), injects it upstream,
// and saves refreshed tokens dinbendon returns in `x-dbd-new-token`.
import { weekRange, summarize, formatSettlement, chunk } from './settle.js';

const UPSTREAM = 'https://www.dinbendon.net/mvc/api';
const SETTLE_CRON = '0 2 * * 5'; // Friday 10:00 Taipei
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

async function upstreamData(env, path) {
  const res = await upstream(env, 'GET', path);
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `dinbendon ${res.status} ${path}`);
  return j.data;
}

// All orders whose expiry falls in this Taipei week, with their items.
async function buildSettlement(env, now = Date.now()) {
  const range = weekRange(now);
  const picked = [];
  for (let first = 0; first < 500; first += 50) {
    const { items } = await upstreamData(env, `/order/manage-orders?first=${first}&size=50&sort=ID&asc=false`);
    for (const o of items) if (o.lastExpireDate >= range.start && o.lastExpireDate < range.end) picked.push(o);
    // Sorted newest first; anything created 2+ weeks before the week can't expire in it.
    if (items.length < 50 || items.at(-1).createDate < range.start - 14 * 86400e3) break;
  }
  picked.sort((a, b) => a.lastExpireDate - b.lastExpireDate);
  const orders = await Promise.all(picked.map(o => upstreamData(env, `/order/${o.orderHashId}/expand-for-buyer`)));
  const people = summarize(orders);
  return { people, text: formatSettlement(people) };
}

async function sendDiscord(env, text) {
  if (!env.DISCORD_WEBHOOK) throw new Error('尚未設定 DISCORD_WEBHOOK');
  for (const content of chunk(text)) {
    const res = await fetch(env.DISCORD_WEBHOOK, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
    });
    if (!res.ok) throw new Error(`Discord ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
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

    // Admin: preview (GET) or send now (POST) this week's settlement.
    if (path === '/_settle') {
      if (!isAdmin) return json({ error: '需要管理碼' }, 403);
      try {
        const { text } = await buildSettlement(env);
        if (request.method === 'POST') await sendDiscord(env, text);
        return json({ data: { text, sent: request.method === 'POST' } });
      } catch (e) { return json({ error: e.message }, 502); }
    }

    // Anyone with the access code: this week's per-person subtotals (same data the Discord post uses).
    if (path === '/_week' && request.method === 'GET') {
      try { return json({ data: (await buildSettlement(env)).people }); } catch (e) { return json({ error: e.message }, 502); }
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

  async scheduled(event, env) {
    if (event.cron === SETTLE_CRON) {
      if (env.DISCORD_WEBHOOK) await sendDiscord(env, (await buildSettlement(env)).text);
      return;
    }
    // Daily ping so dinbendon can hand back a refreshed token before the 30-day expiry.
    await upstream(env, 'POST', '/auth/auth-login');
  },
};
