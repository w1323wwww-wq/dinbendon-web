// CORS proxy: GitHub Pages cannot call dinbendon.net directly (no CORS headers).
// Forwards only the MCP endpoint and the OAuth token endpoint. Stores nothing.
const UPSTREAM = 'https://dinbendon.net';
const PATHS = new Set(['/mcp', '/oauth/token']);

export default {
  async fetch(request, env) {
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    const origin = request.headers.get('Origin') || '';
    if (!allowed.includes(origin)) return new Response('forbidden origin', { status: 403 });

    const cors = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version',
      'Access-Control-Expose-Headers': 'Mcp-Session-Id, WWW-Authenticate',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    if (!PATHS.has(url.pathname)) return new Response('not found', { status: 404, headers: cors });

    const headers = new Headers();
    for (const h of ['Authorization', 'Content-Type', 'Accept', 'Mcp-Session-Id', 'Mcp-Protocol-Version']) {
      const v = request.headers.get(h);
      if (v) headers.set(h, v);
    }
    const upstream = await fetch(UPSTREAM + url.pathname, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
    });
    const out = new Headers(upstream.headers);
    for (const [k, v] of Object.entries(cors)) out.set(k, v);
    return new Response(upstream.body, { status: upstream.status, headers: out });
  },
};
