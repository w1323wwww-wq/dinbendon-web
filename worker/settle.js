// Weekly settlement: pure helpers (covered by ../test.mjs).
const DAY = 86400e3, TPE = 8 * 3600e3;

// Current Taipei week [Monday 00:00, next Monday 00:00) as epoch ms.
export function weekRange(now = Date.now()) {
  const t = new Date(now + TPE);
  const dow = t.getUTCDay() || 7;
  const start = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()) - (dow - 1) * DAY - TPE;
  return { start, end: start + 7 * DAY };
}

// orders (sorted by expiry): [{items:[{buyerName, calculatedPrice, price}]}]
// → people [{name, parts:[per-order subtotal], total}], one part per order the person ordered in.
export function summarize(orders) {
  const people = new Map();
  for (const o of orders) {
    const sub = new Map();
    for (const it of o.items) sub.set(it.buyerName, (sub.get(it.buyerName) || 0) + (it.calculatedPrice ?? it.price ?? 0));
    for (const [name, amount] of sub) {
      const p = people.get(name) || { name, parts: [], total: 0 };
      p.parts.push(amount); p.total += amount;
      people.set(name, p);
    }
  }
  return [...people.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
}

export const personLine = p => `${p.name}: ${p.parts.join(' + ')}${p.parts.length > 1 ? ` = ${p.total}` : ''}`;

export function formatSettlement(people, prefix = '周杰') {
  return [prefix, ...(people.length ? people.map(personLine) : ['本週沒有訂單'])].join('\n');
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
