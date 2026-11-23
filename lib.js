// Pure helpers (no DOM) — covered by test.mjs.

export function b64url(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function pkcePair() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  return { verifier, challenge };
}

// Streamable HTTP may answer with plain JSON or an SSE stream; return the JSON-RPC message with this id.
export function parseRpcResponse(contentType, body, id) {
  if ((contentType || '').includes('text/event-stream')) {
    for (const event of body.split(/\r?\n\r?\n/)) {
      const data = event.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
      if (!data) continue;
      const msg = JSON.parse(data);
      if (msg.id === id) return msg;
    }
    throw new Error('SSE 回應裡找不到對應的結果');
  }
  return JSON.parse(body);
}

// tools/call result → parsed JSON payload; tool errors become thrown Errors with the server's text.
export function unwrapToolResult(result) {
  const text = (result.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
  if (result.isError) throw new Error(text || '操作失敗');
  if (result.structuredContent) return result.structuredContent;
  try { return JSON.parse(text); } catch { return { text }; }
}

// Flat menu rows → [{category, products:[{product, variants:[row]}]}], keeping menu order.
export function groupMenu(items) {
  const cats = new Map();
  for (const it of items) {
    if (!cats.has(it.category)) cats.set(it.category, new Map());
    const prods = cats.get(it.category);
    if (!prods.has(it.product)) prods.set(it.product, []);
    prods.get(it.product).push(it);
  }
  return [...cats].map(([category, prods]) => ({
    category,
    products: [...prods].map(([product, variants]) => ({ product, variants })),
  }));
}

const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六'];

// Dates (YYYY-MM-DD, Taipei) of next week's Mon..Sun relative to `now`.
export function nextWeekDays(now = new Date()) {
  const tpe = new Date(now.getTime() + 8 * 3600e3); // shift so UTC getters read Taipei wall time
  const dow = tpe.getUTCDay() || 7; // Mon=1..Sun=7
  const monday = Date.UTC(tpe.getUTCFullYear(), tpe.getUTCMonth(), tpe.getUTCDate()) + (8 - dow) * 86400e3;
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday + i * 86400e3);
    return { date: d.toISOString().slice(0, 10), weekday: WEEKDAY[d.getUTCDay()] };
  });
}

export function fmtTime(iso) {
  if (!iso) return '不自動截止';
  const d = new Date(iso);
  const tpe = new Date(d.getTime() + 8 * 3600e3);
  const p = n => String(n).padStart(2, '0');
  return `${tpe.getUTCMonth() + 1}/${tpe.getUTCDate()}（${WEEKDAY[tpe.getUTCDay()]}）${p(tpe.getUTCHours())}:${p(tpe.getUTCMinutes())}`;
}
