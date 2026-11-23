// Load siblings with the same cache-busting ?v= that index.html gave this file, so a normal
// reload always picks up a new deploy (GitHub Pages caches files for 10 minutes).
const v = new URL(import.meta.url).search;
const { WORKER_URL } = await import(`./config.js${v}`);
const { flattenMenu, groupMenu, buildAddItemBody, myLines, nextWeekDays, toExpireDate, fmtTime, addHistory, matchHistory } = await import(`./lib.js${v}`);

let $app = document.getElementById('app');
const $nav = document.getElementById('nav');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => `$${Number(n || 0).toLocaleString()}`;
const abs = u => (u.startsWith('/') ? 'https://www.dinbendon.net' + u : u);

// ---------- storage (may be unavailable in private mode) ----------
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
// Per-browser buyer identity, same idea as dinbendon's own dbd-owner-key: lets you cancel only your own items.
function ownerKey() {
  let k = store.get('dbd.owner');
  if (!k) { k = crypto.randomUUID(); store.set('dbd.owner', k); }
  return k;
}

class NeedSetup extends Error { constructor() { super('請輸入通關碼'); } }

async function api(method, path, body, { admin = false } = {}) {
  const headers = { 'X-Access-Code': store.get('dbd.access') || '', 'X-Owner-Key': ownerKey() };
  if (admin) headers['X-Admin-Code'] = store.get('dbd.admin') || '';
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(WORKER_URL + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (res.status === 401) { store.set('dbd.access', null); throw new NeedSetup(); }
  if (res.status === 403 && admin) { store.set('dbd.admin', null); throw new Error('管理碼錯誤'); }
  if (!res.ok || j.error) throw new Error(j.error || `伺服器錯誤（${res.status}）`);
  return j.data;
}

// ---------- small UI helpers ----------
function toast(text) {
  const el = Object.assign(document.createElement('div'), { className: 'toast', textContent: text });
  document.body.append(el);
  setTimeout(() => el.remove(), 2500);
}

function sheet(html) {
  const el = document.createElement('div');
  el.className = 'sheet';
  el.innerHTML = `<div>${html}</div>`;
  el.addEventListener('click', e => { if (e.target === el) el.remove(); });
  document.body.append(el);
  return el;
}

// In-page confirm (native confirm() blocks automation and looks out of place).
function ask(html, okText = '確定') {
  return new Promise(resolve => {
    const el = sheet(`${html}<div class="row" style="justify-content:flex-end;margin-top:16px">
      <button data-a="no">返回</button><button class="primary" data-a="yes">${esc(okText)}</button></div>`);
    el.addEventListener('click', e => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (e.target === el || a) { el.remove(); resolve(a === 'yes'); }
    });
  });
}

function showError(e) {
  if (e instanceof NeedSetup) return renderSetup();
  $app.innerHTML = `<div class="card"><p class="err">${esc(e.message)}</p><button onclick="location.reload()">重新整理</button></div>`;
}

function setNav(active) {
  $nav.innerHTML = store.get('dbd.access')
    ? `<a href="#/" class="${active === 'order' ? 'on' : ''}">點餐</a><a href="#/host" class="${active === 'host' ? 'on' : ''}">開團</a>`
    : '';
}

// ---------- views ----------
function renderSetup() {
  setNav();
  $app.innerHTML = `<div class="hero">
    <div class="logo">🍳</div>
    <p class="big">弘爺生峰店・同事早餐團</p>
    <p class="muted">通關碼請向負責訂餐的同事拿。</p>
    <form id="f" class="row" style="justify-content:center">
      <input id="code" type="password" autocomplete="current-password" placeholder="通關碼" required>
      <input id="name" placeholder="你的名字（訂購人）" value="${esc(store.get('dbd.name') || '')}" required>
      <button class="primary">進入</button>
    </form>
  </div>`;
  $app.querySelector('#f').onsubmit = e => {
    e.preventDefault();
    store.set('dbd.access', $app.querySelector('#code').value.trim());
    store.set('dbd.name', $app.querySelector('#name').value.trim());
    route();
  };
}

const WD = ['日', '一', '二', '三', '四', '五', '六'];
function dateBadge(ms) {
  if (ms == null) return `<div class="date"><b>∞</b><span>隨時</span></div>`;
  const t = new Date(ms + 8 * 3600e3);
  return `<div class="date"><b>${WD[t.getUTCDay()]}</b><span>${t.getUTCMonth() + 1}/${t.getUTCDate()}</span></div>`;
}

async function renderOrders() {
  setNav('order');
  const [progress, week, all] = await Promise.all([
    api('GET', '/order/progress'), api('GET', '/_week').catch(() => null),
    api('GET', '/order/manage-orders?first=0&size=20&sort=ID&asc=false').catch(() => null),
  ]);
  // /order/progress also returns closed orders kept on the home page "for reference".
  const orders = progress.filter(o => o.inProgress);
  const closed = (all?.items || []).filter(o => !o.inProgress && (o.lastExpireDate ?? o.createDate) > Date.now() - 14 * 86400e3).slice(0, 8);
  const me = week?.find(p => p.name === store.get('dbd.name'));
  $app.innerHTML = (week ? `<div class="card hero-total"><div class="muted">${esc(store.get('dbd.name'))} 的本週合計</div>
      <div class="amount">${money(me?.total || 0)}</div>
      ${me?.parts.length > 1 ? `<div class="parts">${me.parts.map(money).join(' + ')}</div>` : ''}</div>` : '') +
    `<h2>進行中的訂單</h2>` + (orders.length ? orders.map(o => `
    <a class="card order" href="#/order/${encodeURIComponent(o.orderHashId)}">
      ${dateBadge(o.expireDate)}
      <div class="grow"><div class="title">${esc(o.originator)}</div>
        <div class="muted">${o.expireDate ? `${esc(fmtTime(o.expireDate))} 截止` : '不自動截止'}${o.passwordLocked ? ' · 🔒' : ''}</div>
        ${o.announcement ? `<div class="muted">📢 ${esc(o.announcement)}</div>` : ''}</div>
      <span class="pill">${o.size} 份 · ${money(o.total)}</span>
    </a>`).join('') : `<p class="muted">目前沒有可以訂的單。</p>`) +
    (closed.length ? `<h2>最近截止</h2>` + closed.map(o => `
    <a class="card order closed" href="#/order/${encodeURIComponent(o.orderHashId)}">
      ${dateBadge(o.lastExpireDate ?? o.createDate)}
      <div class="grow"><div class="title">${esc(o.originator)}</div><div class="muted">已截止</div></div>
      <span class="pill dim">查看</span>
    </a>`).join('') : '') +
    `<p class="muted" style="margin-top:24px">訂購人：${esc(store.get('dbd.name'))} · <a href="#" id="rename">改名字</a></p>`;
  $app.querySelector('#rename').onclick = e => {
    e.preventDefault();
    const el = sheet(`<p class="big">訂購人名字</p><input id="n" style="width:100%" value="${esc(store.get('dbd.name') || '')}">
      <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="primary" data-s>儲存</button></div>`);
    el.querySelector('[data-s]').onclick = () => { store.set('dbd.name', el.querySelector('#n').value.trim()); el.remove(); route(); };
  };
}

async function renderOrder(orderId) {
  setNav('order');
  const expanded = await api('GET', `/order/${orderId}/expand-for-buyer`);
  const open = expanded.inProgress;
  const data = open ? await api('POST', `/order/${orderId}/get-add-item`, { fallbackPlayedBuyerName: null }) : { shop: { categories: [] } };
  const rows = flattenMenu(data);
  const groups = groupMenu(rows);
  const byKey = new Map(rows.map(r => [r.key, r]));
  const cartKey = `dbd.cart.${orderId}`;
  const cart = new Map(store.get(cartKey) || []); // row key → {qty, note}
  let filter = '', cat = '';

  const saveCart = () => store.set(cartKey, cart.size ? [...cart] : null);
  const cartTotal = () => [...cart].reduce((s, [k, c]) => s + (byKey.get(k)?.price || 0) * c.qty, 0);
  const cartQty = () => [...cart].reduce((s, [, c]) => s + c.qty, 0);
  const label = r => r.variation ? `${r.product}（${r.variation}）` : r.product;

  function myLinesHtml(items) {
    const lines = myLines(items, store.get('dbd.name'));
    if (!lines.length) return `<p class="muted">你還沒訂。</p>`;
    let total = 0;
    const html = lines.map(l => {
      const qty = l.ids.length + l.paidIds.length + l.otherIds.length;
      total += qty * l.price;
      return `<div class="prod" data-line="${esc(l.key)}">
        <div class="name">${esc(l.name)}${l.note ? ` <span class="muted">· ${esc(l.note)}</span>` : ''}
          <div class="muted">${esc(l.buyerName)} · ${money(l.price)} × ${qty}</div></div>
        ${open && l.ids.length ? `<button data-one>少一份</button><button data-all>取消</button>` : ''}
      </div>`;
    }).join('');
    return html + `<p class="total-line">總計 <b>${money(total)}</b></p>`;
  }

  // Everyone's items, one row per buyer (dinbendon shows this to the whole group too).
  function allHtml(items) {
    if (!items.length) return `<p class="muted">還沒有人訂。</p>`;
    const byBuyer = new Map();
    for (const it of items) {
      const b = byBuyer.get(it.buyerName) || { total: 0, things: new Map() };
      const k = it.productFullName + (it.comment ? `（${it.comment}）` : '');
      b.things.set(k, (b.things.get(k) || 0) + 1);
      b.total += it.calculatedPrice ?? it.price;
      byBuyer.set(it.buyerName, b);
    }
    return [...byBuyer].map(([name, b]) => `<div class="prod"><div class="name"><b>${esc(name)}</b>
      <div class="muted">${[...b.things].map(([k, n]) => esc(k) + (n > 1 ? ` ×${n}` : '')).join('、')}</div></div><span>${money(b.total)}</span></div>`).join('');
  }

  const again = () => matchHistory(store.get('dbd.history'), rows).filter(h => !(h.row.image && h.row.price === 0));
  const againHtml = () => again().map((h, i) => `<button data-again="${i}">${esc(label(h.row))}${h.note ? ` · ${esc(h.note)}` : ''} ${money(h.row.price)}</button>`).join('');

  function menuHtml() {
    const f = filter.trim().toLowerCase();
    return groups.filter(g => !cat || g.category === cat).map(g => {
      const prods = g.products.filter(p => !f || p.product.toLowerCase().includes(f) || g.category.toLowerCase().includes(f));
      if (!prods.length) return '';
      return `<div class="cat">${esc(g.category)}</div>` + prods.map(p => `
        <div class="prod">${p.variants[0].image ? `<img class="thumb" src="${esc(abs(p.variants[0].image.thumb))}" data-full="${esc(abs(p.variants[0].image.full))}" alt="${esc(p.product)}" loading="lazy">` : ''}<div class="name">${esc(p.product)}</div><div class="variants">${p.variants.filter(v => !(v.image && v.price === 0)).map(v => {
          const n = cart.get(v.key)?.qty;
          return `<button data-add="${esc(v.key)}">${v.variation ? esc(v.variation) + ' ' : ''}${money(v.price)}${n ? `<span class="n">${n}</span>` : ''}</button>`;
        }).join('')}</div></div>`).join('');
    }).join('') || `<p class="muted">找不到符合的品項。</p>`;
  }

  $app.innerHTML = `
    <p><a href="#/">← 所有訂單</a></p>
    <div class="card">
      <div class="row"><span class="big grow">${esc(expanded.originator)} · ${esc(expanded.shopName)}</span>${open ? '' : '<span class="pill dim">已截止</span>'}
        ${store.get('dbd.admin') ? `<button id="toggleopen">${open ? '關團' : '重新開團'}</button>` : ''}</div>
      <div class="muted" id="ordersum">${expanded.size} 份 · ${money(expanded.total)}${expanded.shopTelNo ? ` · ☎ ${esc(expanded.shopTelNo)}` : ''}</div>
      ${data.shop.notice ? `<p class="muted">${esc(data.shop.notice)}</p>` : ''}
    </div>
    <h2>我訂的</h2><div class="card" id="mine">${myLinesHtml(expanded.items)}</div>
    <h2>大家點的</h2><div class="card" id="all">${allHtml(expanded.items)}</div>
    ${open ? '' : '<p class="muted">這張單已截止，不能再訂或取消。</p>'}
    <div ${open ? '' : 'hidden'}>
    <div id="againbox" ${again().length ? '' : 'hidden'}><h2>再買一次</h2><div class="variants" id="again">${againHtml()}</div></div>
    <h2>菜單</h2>
    <input id="q" placeholder="搜尋品項…" style="width:100%">
    <div class="chips" id="chips"><button data-cat="" class="on">全部</button>${groups.map(g => `<button data-cat="${esc(g.category)}">${esc(g.category.length > 12 ? g.category.slice(0, 12) + '…' : g.category)}</button>`).join('')}</div>
    <div id="menu">${menuHtml()}</div>
    </div>
    <div class="cartbar" id="cartbar" hidden><div class="bar"><span class="grow" id="cartsum"></span><button class="primary" id="opencart">查看並送出</button></div></div>`;

  const $menu = $app.querySelector('#menu'), $mine = $app.querySelector('#mine'), $bar = $app.querySelector('#cartbar');
  const refreshBar = () => { $bar.hidden = !open || !cart.size; $app.querySelector('#cartsum').textContent = `${cartQty()} 份 · ${money(cartTotal())}`; };
  const refreshMenu = () => { $menu.innerHTML = menuHtml(); refreshBar(); };
  const reloadMine = async () => {
    const x = await api('GET', `/order/${orderId}/expand-for-buyer`);
    $mine.innerHTML = myLinesHtml(x.items);
    $app.querySelector('#all').innerHTML = allHtml(x.items);
    $app.querySelector('#ordersum').textContent = `${x.size} 份 · ${money(x.total)}${x.shopTelNo ? ` · ☎ ${x.shopTelNo}` : ''}`;
  };
  $app.querySelector('#toggleopen')?.addEventListener('click', async () => {
    if (open) {
      if (!await ask(`<p class="big">關團：${esc(expanded.originator)}？</p><p class="muted">關了之後大家就不能再訂或取消。</p>`, '關團')) return;
      try { await api('POST', '/_open', { orderHashId: orderId, open: false }, { admin: true }); toast('已關團'); route(); }
      catch (err) { toast(err.message); }
      return;
    }
    // Reopen with no auto deadline; the admin closes it with 關團 after ordering.
    const btn = $app.querySelector('#toggleopen'); btn.disabled = true;
    try { await api('POST', '/_open', { orderHashId: orderId, open: true, expireDate: null }, { admin: true }); toast('已重新開團，可以點餐了'); route(); }
    catch (err) { btn.disabled = false; toast(err.message); }
  });
  $app.querySelector('#again').onclick = e => {
    const h = again()[e.target.closest('[data-again]')?.dataset.again]; if (!h) return;
    const c = cart.get(h.row.key) || { qty: 0, note: h.note };
    c.qty = Math.min(99, c.qty + 1); c.note ||= h.note; cart.set(h.row.key, c); saveCart(); refreshMenu();
    toast(`已加入：${label(h.row)}`);
  };
  refreshBar();

  $app.querySelector('#q').oninput = e => { filter = e.target.value; refreshMenu(); };
  $app.querySelector('#chips').onclick = e => {
    const b = e.target.closest('[data-cat]'); if (!b) return;
    cat = b.dataset.cat;
    $app.querySelectorAll('#chips button').forEach(x => x.classList.toggle('on', x === b));
    refreshMenu();
  };
  $menu.onclick = e => {
    if (e.target.dataset.full) {
      const box = document.createElement('div');
      box.className = 'lightbox';
      box.innerHTML = `<img src="${esc(e.target.dataset.full)}" alt="">`;
      box.onclick = () => box.remove();
      return document.body.append(box);
    }
    const k = e.target.closest('[data-add]')?.dataset.add; if (!k) return;
    const c = cart.get(k) || { qty: 0, note: '' };
    c.qty = Math.min(99, c.qty + 1); cart.set(k, c); saveCart(); refreshMenu();
  };

  $mine.onclick = async e => {
    const key = e.target.closest('[data-line]')?.dataset.line; if (!key) return;
    const one = 'one' in e.target.dataset, all = 'all' in e.target.dataset;
    if (!one && !all) return;
    try {
      const line = myLines((await api('GET', `/order/${orderId}/expand-for-buyer`)).items, store.get('dbd.name')).find(l => l.key === key);
      if (!line?.ids.length) return reloadMine();
      const ids = one ? line.ids.slice(-1) : line.ids;
      if (!await ask(`取消「${esc(line.name)}${line.note ? '・' + esc(line.note) : ''}」${ids.length} 份？`, '確定取消')) return;
      await api('POST', `/order/${orderId}/cancel-item`, { orderItemIds: ids });
      toast('已取消');
    } catch (err) { if (err instanceof NeedSetup) return renderSetup(); toast(err.message); }
    reloadMine().catch(() => {});
  };

  $app.querySelector('#opencart').onclick = () => {
    const draw = () => `<p class="big">確認要訂的品項</p>
      <label class="row">訂購人 <input data-name class="grow" value="${esc(store.get('dbd.name') || '')}"></label>
      ${[...cart].map(([k, c]) => { const r = byKey.get(k); return `
        <div class="prod" data-k="${esc(k)}"><div class="name">${esc(r ? label(r) : '（菜單已變更）')}<div class="muted">${money(r?.price)}</div></div>
        <span class="qty"><button data-q="-1">−</button><b>${c.qty}</b><button data-q="1">＋</button></span>
        ${data.allowItemComment ? `<input data-note maxlength="40" placeholder="說明（選填）" value="${esc(c.note)}" style="flex:1 1 100%">` : ''}</div>`; }).join('')}
      <div class="row" style="margin-top:14px"><span class="grow big">${cartQty()} 份 · ${money(cartTotal())}</span>
      <button data-close>繼續點</button><button class="primary" data-send>訂下去</button></div>
      <p class="muted">登記在單上，截止後由負責人統一向店家訂。</p>`;
    const el = sheet(draw()), box = el.firstElementChild;
    box.addEventListener('input', e => {
      if ('name' in e.target.dataset) store.set('dbd.name', e.target.value.trim());
      const k = e.target.closest('[data-k]')?.dataset.k;
      if (k && 'note' in e.target.dataset) { cart.get(k).note = e.target.value; saveCart(); }
    });
    box.addEventListener('click', async e => {
      const k = e.target.closest('[data-k]')?.dataset.k;
      if (k && e.target.dataset.q) {
        const c = cart.get(k); c.qty = Math.min(99, c.qty + Number(e.target.dataset.q));
        if (c.qty <= 0) cart.delete(k);
        saveCart(); refreshMenu();
        if (!cart.size) return el.remove();
        box.innerHTML = draw();
      }
      if ('close' in e.target.dataset) el.remove();
      if ('send' in e.target.dataset) {
        e.target.disabled = true;
        box.querySelector('.err')?.remove();
        try {
          const body = buildAddItemBody(data, rows, cart, store.get('dbd.name'));
          await api('POST', `/order/${orderId}/add-item`, body);
          store.set('dbd.history', addHistory(store.get('dbd.history'), rows, cart));
          $app.querySelector('#again').innerHTML = againHtml(); $app.querySelector('#againbox').hidden = !again().length;
          cart.clear(); saveCart(); el.remove(); refreshMenu();
          await reloadMine();
          toast('訂好了 ✅');
          $mine.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } catch (err) {
          if (err instanceof NeedSetup) { el.remove(); return renderSetup(); }
          e.target.disabled = false;
          box.insertAdjacentHTML('beforeend', `<p class="err">${esc(err.message)}</p>`);
        }
      }
    });
  };
}

// ----- host: token status + weekly batch open -----
function renderAdminLogin() {
  $app.innerHTML = `<div class="hero"><p class="big">開團需要管理碼</p>
    <form id="f" class="row" style="justify-content:center"><input id="code" type="password" placeholder="管理碼" required><button class="primary">確定</button></form></div>`;
  $app.querySelector('#f').onsubmit = e => { e.preventDefault(); store.set('dbd.admin', $app.querySelector('#code').value.trim()); route(); };
}

async function renderHost() {
  setNav('host');
  if (!store.get('dbd.admin')) return renderAdminLogin();
  const tokenInfo = await api('GET', '/_token', undefined, { admin: true });
  const daysLeft = tokenInfo.exp ? Math.floor((tokenInfo.exp - Date.now()) / 86400e3) : null;
  const tokenCard = `
    <h2>dinbendon 群組帳號連線</h2>
    <div class="card">
      <div>${daysLeft == null ? '⚠️ 尚未設定' : daysLeft < 5 ? `⚠️ ${daysLeft} 天後到期` : `✅ 正常（${daysLeft} 天後到期，每天自動續期）`}</div>
      <details ${daysLeft == null ? 'open' : ''}><summary class="muted">更新 token</summary>
        <p class="muted">用群組帳號登入 dinbendon，按 F12 開 Console，輸入 <code>copy(localStorage.getItem('dbd-jwt'))</code>，再貼到下面。</p>
        <div class="row"><input id="tok" class="grow" type="password" placeholder="貼上 token"><button id="savetok">儲存</button></div>
      </details>
    </div>`;
  if (daysLeft == null) {
    $app.innerHTML = tokenCard;
    return bindToken();
  }

  const [shopData, orders] = await Promise.all([
    api('GET', '/shop/available-shops', undefined, { admin: true }), api('GET', '/order/progress').then(p => p.filter(o => o.inProgress)),
  ]);
  const shops = [...(shopData.noCategoryShops || []), ...(shopData.categories || []).flatMap(c => c.shops || [])].filter(s => !s.retired);
  const days = nextWeekDays();
  const tpl = store.get('dbd.tpl') || { shop: shops[0]?.shopHashId, time: '08:00', on: ['一', '二', '三', '四', '五'], suffix: '早餐' };

  $app.innerHTML = tokenCard + `
    <h2>每週結算</h2>
    <div class="card">
      <div class="muted">每週五 10:00 自動把本週每個人的金額發到 Discord（需設定 webhook）。</div>
      <div class="row" style="margin-top:10px"><button id="preview">預覽本週</button><button id="copysettle">複製</button><button id="sendnow">現在發到 Discord</button></div>
      <pre id="settle" hidden></pre>
    </div>
    <h2>開下週的單</h2>
    <div class="card">
      <div class="row"><select id="shop" class="grow">${shops.map(s => `<option value="${esc(s.shopHashId)}" ${s.shopHashId === tpl.shop ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
      <div class="row" style="margin-top:10px">
        <label>名稱後綴 <input id="suffix" value="${esc(tpl.suffix)}" style="width:80px"></label>
        <label>每天截止 <input id="time" type="time" value="${esc(tpl.time)}"></label>
      </div>
      <table style="margin-top:10px"><tbody>${days.map(d => `
        <tr><td><label><input type="checkbox" data-day="${d.date}" data-wd="${d.weekday}" ${tpl.on.includes(d.weekday) ? 'checked' : ''}> ${d.date.slice(5).replace('-', '/')}（${d.weekday}）</label></td>
        <td class="muted" data-label="${d.date}"></td></tr>`).join('')}</tbody></table>
      <label class="row" style="margin-top:10px"><input type="checkbox" id="notify"> 開單時通知群組</label>
      <div class="row" style="margin-top:12px"><span class="grow"></span><button class="primary" id="open">開單</button></div>
      <div id="openlog"></div>
    </div>
    <h2>進行中的訂單</h2>
    ${orders.map(o => `<div class="card row"><span class="grow"><b>${esc(o.originator)}</b> <span class="muted">${esc(o.shopName)} · 截止 ${esc(fmtTime(o.expireDate))} · ${o.size} 份 ${money(o.total)}</span></span>
      <a href="https://www.dinbendon.net/do/order?id=${encodeURIComponent(o.orderHashId)}" target="_blank" rel="noopener">在 dinbendon 管理 ↗</a></div>`).join('') || '<p class="muted">沒有。</p>'}`;
  bindToken();

  const $ = s => $app.querySelector(s);
  const settle = async (method) => {
    const out = $('#settle'); out.hidden = false; out.textContent = '計算中…';
    try { const r = await api(method, '/_settle', undefined, { admin: true }); out.textContent = r.text; if (r.sent) toast('已發到 Discord'); }
    catch (e) { out.textContent = e.message; }
  };
  $('#preview').onclick = () => settle('GET');
  $('#copysettle').onclick = async () => {
    try { const r = await api('GET', '/_settle', undefined, { admin: true }); await navigator.clipboard.writeText(r.text); toast('已複製'); }
    catch (e) { toast(e.message); }
  };
  $('#sendnow').onclick = async () => { if (await ask('<p class="big">現在把本週結算發到 Discord？</p>', '發送')) settle('POST'); };
  const labels = () => {
    for (const cb of $app.querySelectorAll('[data-day]'))
      $app.querySelector(`[data-label="${cb.dataset.day}"]`).textContent = cb.checked ? `週${cb.dataset.wd}${$('#suffix').value}，${$('#time').value} 截止` : '';
  };
  labels();
  $app.addEventListener('input', labels);
  $('#open').onclick = async () => {
    const picked = [...$app.querySelectorAll('[data-day]:checked')].map(cb => ({ date: cb.dataset.day, wd: cb.dataset.wd }));
    const shop = $('#shop').value, shopName = $('#shop').selectedOptions[0]?.text, time = $('#time').value, suffix = $('#suffix').value.trim();
    const notify = $('#notify').checked;
    if (!picked.length || !shop || !time) return toast('請選店家、日期和截止時間');
    const ok = await ask(`<p class="big">在「${esc(shopName)}」開 ${picked.length} 張單？</p>
      <ul>${picked.map(p => `<li>週${p.wd}${esc(suffix)}：${p.date.slice(5)} ${time} 截止</li>`).join('')}</ul>
      <p class="muted">${notify ? '⚠️ 會通知群組' : '不通知群組'}</p>`, `開 ${picked.length} 張`);
    if (!ok) return;
    store.set('dbd.tpl', { shop, time, suffix, on: picked.map(p => p.wd) });
    const log = $('#openlog'); log.innerHTML = '';
    for (const p of picked) {
      const originator = `週${p.wd}${suffix}`;
      try {
        await api('POST', '/order/create', {
          shopHashId: shop, originator, managePassword: null, expireDate: toExpireDate(p.date, time),
          maxQty: null, maxTotalCost: null, announcement: null, notify,
          selectedDepartmentIds: (shopData.departments || []).map(d => d.id),
          allowMisc: false, allowItemComment: true, buyerInfoDefines: Array(8).fill(null), orderLimits: null,
        }, { admin: true });
        log.insertAdjacentHTML('beforeend', `<p>✅ ${esc(originator)}</p>`);
      } catch (e) {
        log.insertAdjacentHTML('beforeend', `<p class="err">❌ ${esc(originator)}：${esc(e.message)}</p>`);
      }
    }
    toast('完成'); setTimeout(route, 1500);
  };
}

function bindToken() {
  const btn = $app.querySelector('#savetok'); if (!btn) return;
  btn.onclick = async () => {
    const token = $app.querySelector('#tok').value.trim().replace(/^"|"$/g, '');
    try { await api('POST', '/_token', { token }, { admin: true }); toast('已更新'); route(); }
    catch (e) { toast(e.message); }
  };
}

// ---------- router ----------
async function route() {
  // Fresh node per view so listeners from the previous view don't pile up.
  const fresh = $app.cloneNode(false); $app.replaceWith(fresh); $app = fresh;
  if (!store.get('dbd.access') || !store.get('dbd.name')) return renderSetup();
  const [, view, id] = location.hash.replace(/^#\/?/, '#/').split('/');
  $app.innerHTML = `<p class="muted">載入中…</p>`;
  try {
    if (view === 'order' && id) await renderOrder(decodeURIComponent(id));
    else if (view === 'host') await renderHost();
    else await renderOrders();
  } catch (e) { showError(e); }
}

window.addEventListener('hashchange', route);
route();
