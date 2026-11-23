// Weekly settlement: pure helpers (covered by ../test.mjs).
const DAY = 86400e3, TPE = 8 * 3600e3;
const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六'];

// Current Taipei week [Monday 00:00, next Monday 00:00) as epoch ms.
export function weekRange(now = Date.now()) {
  const t = new Date(now + TPE);
  const dow = t.getUTCDay() || 7;
  const start = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()) - (dow - 1) * DAY - TPE;
  return { start, end: start + 7 * DAY };
}

const md = ms => { const t = new Date(ms + TPE); return `${t.getUTCMonth() + 1}/${t.getUTCDate()}（${WEEKDAY[t.getUTCDay()]}）`; };

// orders: [{originator, shopName, lastExpireDate, items:[{buyerName, calculatedPrice, price, paid}]}]
export function summarize(orders) {
  const people = new Map();
  let total = 0;
  for (const o of orders) {
    for (const it of o.items) {
      const price = it.calculatedPrice ?? it.price ?? 0;
      const p = people.get(it.buyerName) || { name: it.buyerName, total: 0, unpaid: 0, count: 0 };
      p.total += price; p.count++; if (!it.paid) p.unpaid += price;
      people.set(it.buyerName, p);
      total += price;
    }
  }
  return { people: [...people.values()].sort((a, b) => b.unpaid - a.unpaid || b.total - a.total), total };
}

export function formatSettlement({ start, end }, orders, { people, total }) {
  const lines = [`🍱 **本週訂餐結算** ${md(start)} – ${md(end - DAY)}`];
  if (!orders.length) return lines.concat('本週沒有訂單。').join('\n');
  lines.push('', ...orders.map(o => `・${md(o.lastExpireDate)} ${o.originator}（${o.shopName}）${o.items.length} 份`), '');
  for (const p of people) {
    lines.push(p.unpaid === 0 ? `✅ ${p.name}：$${p.total}（已付清）` : `💰 ${p.name}：**$${p.unpaid}**${p.unpaid !== p.total ? `（共 $${p.total}，已付 $${p.total - p.unpaid}）` : ''}`);
  }
  const unpaid = people.reduce((s, p) => s + p.unpaid, 0);
  lines.push('', `合計 $${total}，未收 $${unpaid}`);
  return lines.join('\n');
}

// Discord messages max 2000 chars; split on line boundaries.
export function chunk(text, max = 1900) {
  const out = [];
  let cur = '';
  for (const line of text.split('\n')) {
    if (cur && cur.length + line.length + 1 > max) { out.push(cur); cur = ''; }
    cur = cur ? `${cur}\n${line}` : line;
  }
  if (cur) out.push(cur);
  return out;
}
