// Pure helpers (no DOM) — covered by test.mjs.

// get-add-item response → flat rows, one per product × variation.
export function flattenMenu(data) {
  const rows = [];
  for (const c of data.shop.categories) {
    for (const p of c.products) {
      for (const v of p.variations) {
        rows.push({
          key: `${p.id}:${v.id}`, productId: p.id, variationId: v.id,
          category: c.defined ? c.name : '其他', categoryName: c.defined ? c.name : null,
          product: p.name, variation: v.name || '', price: v.price,
          image: p.image ? { thumb: p.image.thumbnailUrl || p.image.url, full: p.image.url } : null,
        });
      }
    }
  }
  return rows;
}

// Flat rows → [{category, products:[{product, variants:[row]}]}], keeping menu order.
export function groupMenu(rows) {
  const cats = new Map();
  for (const r of rows) {
    if (!cats.has(r.category)) cats.set(r.category, new Map());
    const prods = cats.get(r.category);
    if (!prods.has(r.product)) prods.set(r.product, []);
    prods.get(r.product).push(r);
  }
  return [...cats].map(([category, prods]) => ({
    category,
    products: [...prods].map(([product, variants]) => ({ product, variants })),
  }));
}

// Same payload the dinbendon web form sends to /order/{id}/add-item.
export function buildAddItemBody(data, rows, cart, playedName) {
  const byKey = new Map(rows.map(r => [r.key, r]));
  const addProducts = [];
  for (const [key, c] of cart) {
    const r = byKey.get(key);
    if (!r) throw new Error('菜單已變更，請重新整理');
    if (!(c.qty >= 1 && c.qty <= 99)) throw new Error(`「${r.product}」份數要在 1–99`);
    addProducts.push({
      productId: r.productId, variationId: r.variationId, qty: c.qty, comment: c.note?.trim() || null,
      categoryName: r.categoryName, productName: r.product, variationName: r.variation, price: r.price,
    });
  }
  if (!addProducts.length) throw new Error('還沒選品項');
  if (!playedName?.trim()) throw new Error('請填訂購人名字');
  return { addProducts, playedName: playedName.trim(), buyerInfo: null, addMisc: null, shopRevisionNo: data.shop.revisionNo };
}

// expand-for-buyer items → my lines: items this browser placed (`buyer`) or under my name,
// merged by name + note + price. Only this browser's unpaid items are cancelable (`ids`).
export function myLines(items, myName = '') {
  const lines = new Map();
  for (const it of items.filter(i => i.buyer || (myName && i.buyerName === myName))) {
    const k = `${it.buyerName}|${it.productFullName}|${it.comment || ''}|${it.price}`;
    if (!lines.has(k)) lines.set(k, { key: k, buyerName: it.buyerName, name: it.productFullName, note: it.comment || '', price: it.calculatedPrice ?? it.price, ids: [], paidIds: [], otherIds: [] });
    const l = lines.get(k);
    (it.paid ? l.paidIds : it.buyer ? l.ids : l.otherIds).push(it.id);
  }
  return [...lines.values()];
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

// "2026-12-01" + "08:00" → "20261201 0800" (format the dinbendon create form accepts)
export const toExpireDate = (date, time) => `${date.replace(/-/g, '')} ${time.replace(':', '')}`;

export function fmtTime(t) {
  if (t == null) return '不自動截止';
  const tpe = new Date(new Date(t).getTime() + 8 * 3600e3);
  const p = n => String(n).padStart(2, '0');
  return `${tpe.getUTCMonth() + 1}/${tpe.getUTCDate()}（${WEEKDAY[tpe.getUTCDay()]}）${p(tpe.getUTCHours())}:${p(tpe.getUTCMinutes())}`;
}

// ----- 再買一次: per-browser order history -----
const histKey = h => `${h.product}|${h.variation}|${h.note}`;

// Prepend just-ordered items (newest first), dedupe by product+variation+note, keep `max`.
export function addHistory(history, rows, cart, max = 12) {
  const byKey = new Map(rows.map(r => [r.key, r]));
  const fresh = [...cart].map(([k, c]) => byKey.get(k) && { product: byKey.get(k).product, variation: byKey.get(k).variation, note: c.note?.trim() || '' }).filter(Boolean);
  const seen = new Set();
  return [...fresh, ...(history || [])].filter(h => !seen.has(histKey(h)) && seen.add(histKey(h))).slice(0, max);
}

// History entries still on this menu (matched by name, so it survives menu edits), with their row.
export function matchHistory(history, rows) {
  const byName = new Map(rows.map(r => [`${r.product}|${r.variation}`, r]));
  return (history || []).map(h => ({ ...h, row: byName.get(`${h.product}|${h.variation}`) })).filter(h => h.row);
}
