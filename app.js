import { WORKER_URL } from './config.js';
import { b64url, pkcePair, parseRpcResponse, unwrapToolResult, groupMenu, nextWeekDays, fmtTime } from './lib.js';

const ISSUER = 'https://dinbendon.net';
const RESOURCE = 'https://dinbendon.net/mcp';
const PROTOCOL = '2025-06-18';
const REDIRECT_URI = location.origin + location.pathname.replace(/index\.html$/, '');
const CLIENT_ID = new URL('client.json', REDIRECT_URI).href;

let $app = document.getElementById('app');
const $nav = document.getElementById('nav');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => `$${Number(n || 0).toLocaleString()}`;

// ---------- storage (may be unavailable in private mode) ----------
const store = {
  get(k, s = localStorage) { try { return JSON.parse(s.getItem(k)); } catch { return null; } },
  set(k, v, s = localStorage) { try { v == null ? s.removeItem(k) : s.setItem(k, JSON.stringify(v)); } catch {} },
};

// ---------- OAuth (public client + PKCE; client_id is our client.json URL) ----------
async function login() {
  const { verifier, challenge } = await pkcePair();
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  store.set('dbd.pkce', { verifier, state, back: location.hash }, sessionStorage);
  const q = new URLSearchParams({
    response_type: 'code', client_id: CLIENT_ID, redirect_uri: REDIRECT_URI,
    code_challenge: challenge, code_challenge_method: 'S256', state,
    scope: 'dinbendon:order', resource: RESOURCE,
  });
  location.assign(`${ISSUER}/oauth/authorize?${q}`);
}

async function tokenRequest(params) {
  const res = await fetch(`${WORKER_URL}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ client_id: CLIENT_ID, resource: RESOURCE, ...params }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(data.error_description || data.error || `登入失敗（${res.status}）`);
  const tokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || params.refresh_token,
    expires_at: Date.now() + (data.expires_in || 3600) * 1000,
  };
  store.set('dbd.tokens', tokens);
  return tokens;
}

async function handleCallback() {
  const q = new URLSearchParams(location.search);
  if (!q.has('code') && !q.has('error')) return;
  const saved = store.get('dbd.pkce', sessionStorage);
  store.set('dbd.pkce', null, sessionStorage);
  history.replaceState(null, '', REDIRECT_URI + (saved?.back || ''));
  if (q.get('error')) throw new Error(`授權未完成：${q.get('error_description') || q.get('error')}`);
  if (!saved || q.get('state') !== saved.state) throw new Error('授權狀態不符，請重新登入');
  if (q.has('iss') && q.get('iss') !== ISSUER) throw new Error('授權來源不符，請重新登入');
  await tokenRequest({ grant_type: 'authorization_code', code: q.get('code'), redirect_uri: REDIRECT_URI, code_verifier: saved.verifier });
}

let refreshing = null;
async function accessToken(force = false) {
  const t = store.get('dbd.tokens');
  if (!t) throw new NeedLogin();
  if (!force && t.expires_at - Date.now() > 60e3) return t.access_token;
  if (!t.refresh_token) { logout(); throw new NeedLogin(); }
  refreshing ||= tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh_token })
    .catch(() => { logout(); throw new NeedLogin(); })
    .finally(() => { refreshing = null; });
  return (await refreshing).access_token;
}

function logout() { store.set('dbd.tokens', null); sessionId = null; initDone = null; }
class NeedLogin extends Error { constructor() { super('請先登入'); } }

// ---------- MCP over Streamable HTTP, via the Worker ----------
let sessionId = null, initDone = null, rpcSeq = 0;

async function rpc(method, params, { notify = false, retried = false } = {}) {
  const msg = notify ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id: ++rpcSeq, method, params };
  const headers = {
    Authorization: `Bearer ${await accessToken(retried === 'auth')}`,
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;
  if (method !== 'initialize') headers['Mcp-Protocol-Version'] = PROTOCOL;
  const res = await fetch(`${WORKER_URL}/mcp`, { method: 'POST', headers, body: JSON.stringify(msg) });
  if (res.status === 401 && !retried) return rpc(method, params, { notify, retried: 'auth' });
  if (res.status === 401) { logout(); throw new NeedLogin(); }
  if (res.status === 404 && sessionId) { sessionId = null; initDone = null; throw new SessionExpired(); }
  const sid = res.headers.get('Mcp-Session-Id');
  if (sid) sessionId = sid;
  if (notify) return;
  const text = await res.text();
  if (!res.ok) throw new Error(`伺服器錯誤（${res.status}）${text.slice(0, 200)}`);
  const reply = parseRpcResponse(res.headers.get('Content-Type'), text, msg.id);
  if (reply.error) throw new Error(reply.error.message || '伺服器錯誤');
  return reply.result;
}
class SessionExpired extends Error {}

function ensureInit() {
  initDone ||= (async () => {
    await rpc('initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'dinbendon-web', version: '1.0' } });
    await rpc('notifications/initialized', undefined, { notify: true });
  })().catch(e => { initDone = null; throw e; });
  return initDone;
}

async function tool(name, args = {}, again = true) {
  await ensureInit();
  try {
    return unwrapToolResult(await rpc('tools/call', { name, arguments: args }));
  } catch (e) {
    if (e instanceof SessionExpired && again) return tool(name, args, false);
    throw e;
  }
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
      <button data-a="no">取消</button><button class="primary" data-a="yes">${esc(okText)}</button></div>`);
    el.addEventListener('click', e => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (e.target === el || a) { el.remove(); resolve(a === 'yes'); }
    });
  });
}

function showError(e) {
  if (e instanceof NeedLogin) return renderLogin();
  $app.innerHTML = `<div class="card"><p class="err">${esc(e.message)}</p><button onclick="location.reload()">重新整理</button></div>`;
}

function setNav(active) {
  const loggedIn = !!store.get('dbd.tokens');
  $nav.innerHTML = loggedIn
    ? `<a href="#/" class="${active === 'order' ? 'on' : ''}">點餐</a><a href="#/host" class="${active === 'host' ? 'on' : ''}">開團</a><a href="#" id="logout">登出</a>`
    : '';
  $nav.querySelector('#logout')?.addEventListener('click', e => { e.preventDefault(); logout(); route(); });
}

// ---------- views ----------
function renderLogin() {
  setNav();
  $app.innerHTML = `<div class="hero">
    <p class="big">用你的 dinbendon 個人帳號登入</p>
    <p class="muted">會跳到 dinbendon 的授權頁：登入個人帳號 → 選群組 → 按「同意」。<br>這個頁面拿不到你的密碼，授權可隨時在 dinbendon 管理中心撤銷。</p>
    <button class="primary" id="login">登入 dinbendon</button>
    <p class="muted" style="margin-top:24px">還沒有個人帳號？用群組帳號登入 dinbendon，首頁上方「申請個人帳號」。</p>
  </div>`;
  $app.querySelector('#login').onclick = login;
}

const orderLabel = o => o.announcement ? `${o.announcement}` : o.originator;

async function renderOrders() {
  setNav('order');
  const { orders } = await tool('list_open_orders');
  $app.innerHTML = `<h2>進行中的訂單</h2>` + (orders.length ? orders.map(o => `
    <a class="card" href="#/order/${encodeURIComponent(o.order)}">
      <div class="row"><span class="big grow">${esc(orderLabel(o))}</span><span class="pill">${o.item_count} 份 · ${money(o.total)}</span></div>
      <div class="muted">${esc(o.shop_name)} · 負責人 ${esc(o.originator)} · 截止 ${esc(fmtTime(o.expire_at))}</div>
    </a>`).join('') : `<p class="muted">目前沒有可以訂的單。</p>`);
}

async function renderOrder(orderId) {
  setNav('order');
  const [menu, mine] = await Promise.all([tool('get_menu', { order: orderId }), tool('get_my_order', { order: orderId })]);
  const groups = groupMenu(menu.items);
  const byId = new Map(menu.items.map(i => [i.menu_item_id, i]));
  const cartKey = `dbd.cart.${orderId}`;
  const cart = new Map(store.get(cartKey) || []); // menu_item_id → {qty, note}
  let filter = '', cat = '';

  const saveCart = () => store.set(cartKey, cart.size ? [...cart] : null);
  const cartTotal = () => [...cart].reduce((s, [id, c]) => s + (byId.get(id)?.price || 0) * c.qty, 0);
  const cartQty = () => [...cart].reduce((s, [, c]) => s + c.qty, 0);
  const left = i => (i.remaining ?? i.available ?? null);

  function myLinesHtml(m) {
    if (!m.lines?.length) return `<p class="muted">你還沒訂。</p>`;
    return m.lines.map(l => `
      <div class="prod" data-line="${esc(l.line_id)}">
        <div class="name">${esc(l.item || l.product)}${l.note ? ` <span class="muted">· ${esc(l.note)}</span>` : ''}
          <div class="muted">${money(l.price)}${l.paid_qty ? ` · <span class="pill ok">已付 ${l.paid_qty}</span>` : ''}</div></div>
        <span class="qty"><button data-q="-1">−</button><b>${l.qty}</b><button data-q="1">＋</button></span>
        ${menu.accepts_notes ? `<button data-note>說明</button>` : ''}
        <button data-del>取消</button>
      </div>`).join('') + `<p class="muted" style="text-align:right">應付 ${money(m.my_total)} · 已付 ${money(m.my_paid)} · 未付 <b>${money(m.my_unpaid)}</b></p>`;
  }

  function menuHtml() {
    const f = filter.trim().toLowerCase();
    return groups.filter(g => !cat || g.category === cat).map(g => {
      const prods = g.products.filter(p => !f || p.product.toLowerCase().includes(f) || g.category.toLowerCase().includes(f));
      if (!prods.length) return '';
      return `<div class="cat">${esc(g.category)}</div>` + prods.map(p => `
        <div class="prod"><div class="name">${esc(p.product)}</div><div class="variants">${p.variants.map(v => {
          const n = cart.get(v.menu_item_id)?.qty, soldOut = left(v) === 0;
          return `<button data-add="${esc(v.menu_item_id)}" ${soldOut ? 'disabled' : ''}>${v.variation ? esc(v.variation) + ' ' : ''}${money(v.price)}${soldOut ? ' 售完' : ''}${n ? `<span class="n">${n}</span>` : ''}</button>`;
        }).join('')}</div></div>`).join('');
    }).join('') || `<p class="muted">找不到符合的品項。</p>`;
  }

  $app.innerHTML = `
    <p><a href="#/">← 所有訂單</a></p>
    <div class="card">
      <div class="big">${esc(menu.shop_name)}</div>
      <div class="muted">截止 ${esc(fmtTime(menu.expire_at))}</div>
      ${menu.announcement ? `<p>📢 ${esc(menu.announcement)}</p>` : ''}
      ${menu.shop_notice ? `<p class="muted">${esc(menu.shop_notice)}</p>` : ''}
    </div>
    <h2>我訂的</h2><div class="card" id="mine">${myLinesHtml(mine)}</div>
    <h2>菜單</h2>
    <input id="q" placeholder="搜尋品項…" style="width:100%">
    <div class="chips" id="chips"><button data-cat="" class="on">全部</button>${groups.map(g => `<button data-cat="${esc(g.category)}">${esc(g.category.length > 12 ? g.category.slice(0, 12) + '…' : g.category)}</button>`).join('')}</div>
    <div id="menu">${menuHtml()}</div>
    <div class="cartbar" id="cartbar" hidden><div class="bar"><span class="grow" id="cartsum"></span><button class="primary" id="opencart">查看並送出</button></div></div>`;

  const $menu = $app.querySelector('#menu'), $mine = $app.querySelector('#mine'), $bar = $app.querySelector('#cartbar');
  const refreshBar = () => { $bar.hidden = !cart.size; $app.querySelector('#cartsum').textContent = `${cartQty()} 份 · ${money(cartTotal())}`; };
  const refreshMenu = () => { $menu.innerHTML = menuHtml(); refreshBar(); };
  refreshBar();

  $app.querySelector('#q').oninput = e => { filter = e.target.value; refreshMenu(); };
  $app.querySelector('#chips').onclick = e => {
    const b = e.target.closest('[data-cat]'); if (!b) return;
    cat = b.dataset.cat;
    $app.querySelectorAll('#chips button').forEach(x => x.classList.toggle('on', x === b));
    refreshMenu();
  };
  $menu.onclick = e => {
    const id = e.target.closest('[data-add]')?.dataset.add; if (!id) return;
    const c = cart.get(id) || { qty: 0, note: '' };
    c.qty++; cart.set(id, c); saveCart(); refreshMenu();
  };

  async function mineAction(fn, okMsg) {
    try { const m = await fn(); $mine.innerHTML = myLinesHtml(m.lines ? m : await tool('get_my_order', { order: orderId })); toast(okMsg); }
    catch (err) { if (err instanceof NeedLogin) return renderLogin(); toast(err.message); $mine.innerHTML = myLinesHtml(await tool('get_my_order', { order: orderId })); }
  }
  $mine.onclick = async e => {
    const row = e.target.closest('[data-line]'); if (!row) return;
    const line = (await tool('get_my_order', { order: orderId })).lines.find(l => l.line_id === row.dataset.line);
    if (!line) return mineAction(() => tool('get_my_order', { order: orderId }), '已更新');
    const name = esc(line.item || line.product);
    if (e.target.dataset.q) {
      const qty = line.qty + Number(e.target.dataset.q);
      if (qty === 0 && !await ask(`取消「${name}」？`, '取消這項')) return;
      return mineAction(() => tool('set_line_qty', { order: orderId, line_id: line.line_id, qty }), '已更新份數');
    }
    if ('del' in e.target.dataset) {
      if (!await ask(`取消「${name}」全部 ${line.qty} 份？`, '取消這項')) return;
      return mineAction(() => tool('remove_line', { order: orderId, line_id: line.line_id }), '已取消');
    }
    if ('note' in e.target.dataset) {
      const el = sheet(`<p class="big">${name}</p><input id="n" maxlength="40" style="width:100%" placeholder="品項說明，例如：不要辣" value="${esc(line.note || '')}">
        <div class="row" style="justify-content:flex-end;margin-top:12px"><button data-x>取消</button><button class="primary" data-s>儲存</button></div>`);
      el.querySelector('[data-x]').onclick = () => el.remove();
      el.querySelector('[data-s]').onclick = () => {
        const note = el.querySelector('#n').value.trim(); el.remove();
        mineAction(() => tool('edit_line_note', { order: orderId, line_id: line.line_id, ...(note && { note }) }), '已更新說明');
      };
    }
  };

  $app.querySelector('#opencart').onclick = () => {
    const draw = () => `<p class="big">確認要訂的品項</p>
      ${[...cart].map(([id, c]) => { const i = byId.get(id); return `
        <div class="prod" data-id="${esc(id)}"><div class="name">${esc(i?.item ?? '（菜單已變更）')}<div class="muted">${money(i?.price)}</div></div>
        <span class="qty"><button data-q="-1">−</button><b>${c.qty}</b><button data-q="1">＋</button></span>
        ${menu.accepts_notes ? `<input data-note maxlength="40" placeholder="說明（選填）" value="${esc(c.note)}" style="flex:1 1 100%">` : ''}</div>`; }).join('')}
      <div class="row" style="margin-top:14px"><span class="grow big">${cartQty()} 份 · ${money(cartTotal())}</span>
      <button data-close>繼續點</button><button class="primary" data-send>訂下去</button></div>
      <p class="muted">登記在單上，截止後由負責人統一向店家訂。</p>`;
    const el = sheet(draw()), box = el.firstElementChild;
    box.addEventListener('input', e => { const id = e.target.closest('[data-id]')?.dataset.id; if (id && 'note' in e.target.dataset) { cart.get(id).note = e.target.value; saveCart(); } });
    box.addEventListener('click', async e => {
      const id = e.target.closest('[data-id]')?.dataset.id;
      if (id && e.target.dataset.q) {
        const c = cart.get(id); c.qty += Number(e.target.dataset.q);
        if (c.qty <= 0) cart.delete(id);
        saveCart(); refreshMenu();
        if (!cart.size) return el.remove();
        box.innerHTML = draw();
      }
      if ('close' in e.target.dataset) el.remove();
      if ('send' in e.target.dataset) {
        e.target.disabled = true;
        try {
          const items = [...cart].map(([menu_item_id, c]) => ({ menu_item_id, qty: c.qty, ...(c.note.trim() && { note: c.note.trim() }) }));
          const m = await tool('add_items', { order: orderId, items });
          cart.clear(); saveCart(); el.remove(); refreshMenu();
          $mine.innerHTML = myLinesHtml(m.lines ? m : await tool('get_my_order', { order: orderId }));
          toast('訂好了 ✅');
          $mine.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } catch (err) {
          if (err instanceof NeedLogin) { el.remove(); return renderLogin(); }
          e.target.disabled = false;
          box.insertAdjacentHTML('beforeend', `<p class="err">${esc(err.message)}</p>`);
        }
      }
    });
  };
}

// ----- host: weekly batch open + my hosted orders -----
async function renderHost() {
  setNav('host');
  const [{ shops }, { orders }] = await Promise.all([tool('search_shops'), tool('list_my_hosted_orders')]);
  const days = nextWeekDays();
  const tpl = store.get('dbd.tpl') || { shop_id: shops[0]?.shop_id, time: '08:00', on: ['一', '二', '三', '四', '五'], suffix: '早餐' };
  let shopList = shops;

  const shopOptions = () => shopList.map(s => `<option value="${esc(s.shop_id)}" ${s.shop_id === tpl.shop_id ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
  $app.innerHTML = `
    <h2>開下週的單</h2>
    <div class="card">
      <div class="row"><select id="shop" class="grow">${shopOptions()}</select>
        <input id="kw" placeholder="搜尋公用店家" style="width:140px"><button id="find">搜尋</button></div>
      <div class="row" style="margin-top:10px">
        <label>名稱後綴 <input id="suffix" value="${esc(tpl.suffix)}" style="width:80px"></label>
        <label>每天截止 <input id="time" type="time" value="${esc(tpl.time)}"></label>
      </div>
      <table style="margin-top:10px"><tbody>${days.map(d => `
        <tr><td><label><input type="checkbox" data-day="${d.date}" data-wd="${d.weekday}" ${tpl.on.includes(d.weekday) ? 'checked' : ''}> ${d.date.slice(5).replace('-', '/')}（${d.weekday}）</label></td>
        <td class="muted" data-label="${d.date}"></td></tr>`).join('')}</tbody></table>
      <label class="row" style="margin-top:10px"><input type="checkbox" id="notify"> 開單時通知整個群組（寄信／推播）</label>
      <div class="row" style="margin-top:12px"><span class="grow muted">負責人會顯示你的暱稱；「週二早餐」這類名稱放在公告。</span><button class="primary" id="open">開單</button></div>
      <div id="openlog"></div>
    </div>
    <h2>我開的單</h2>
    ${orders.length ? orders.map(o => `
      <a class="card" href="#/host/${encodeURIComponent(o.order)}">
        <div class="row"><span class="big grow">${esc(orderLabel(o))}</span><span class="pill">${o.item_count ?? 0} 份 · ${money(o.total)}</span></div>
        <div class="muted">${esc(o.shop_name)} · 截止 ${esc(fmtTime(o.expire_at))}${o.open === false ? ' · 已截止' : ''}</div>
      </a>`).join('') : `<p class="muted">你還沒有用個人帳號開過單。</p>`}`;

  const $ = s => $app.querySelector(s);
  const labels = () => {
    for (const cb of $app.querySelectorAll('[data-day]')) $app.querySelector(`[data-label="${cb.dataset.day}"]`).textContent = cb.checked ? `週${cb.dataset.wd}${$('#suffix').value}，${cb.dataset.day.slice(5).replace('-', '/')} ${$('#time').value} 截止` : '';
  };
  labels();
  $app.addEventListener('input', labels);
  $('#find').onclick = async () => {
    const kw = $('#kw').value.trim(); if (kw.length < 2) return toast('至少 2 個字');
    shopList = (await tool('search_shops', { keyword: kw })).shops;
    if (!shopList.length) return toast('找不到店家');
    tpl.shop_id = shopList[0].shop_id; $('#shop').innerHTML = shopOptions();
  };
  $('#open').onclick = async () => {
    const picked = [...$app.querySelectorAll('[data-day]:checked')].map(cb => ({ date: cb.dataset.day, wd: cb.dataset.wd }));
    const shopId = $('#shop').value, shopName = $('#shop').selectedOptions[0]?.text, time = $('#time').value, suffix = $('#suffix').value.trim();
    const notify = $('#notify').checked;
    if (!picked.length || !shopId || !time) return toast('請選店家、日期和截止時間');
    const ok = await ask(`<p class="big">在「${esc(shopName)}」開 ${picked.length} 張單？</p>
      <ul>${picked.map(p => `<li>週${p.wd}${esc(suffix)}：${p.date.slice(5)} ${time} 截止</li>`).join('')}</ul>
      <p class="muted">${notify ? '⚠️ 會通知整個群組' : '不通知群組'}</p>`, `開 ${picked.length} 張`);
    if (!ok) return;
    store.set('dbd.tpl', { shop_id: shopId, time, suffix, on: picked.map(p => p.wd) });
    const log = $('#openlog'); log.innerHTML = '';
    for (const p of picked) {
      try {
        await tool('open_order', { shop_id: shopId, expire_at: `${p.date}T${time}`, announcement: `週${p.wd}${suffix}`, notify });
        log.insertAdjacentHTML('beforeend', `<p>✅ 週${p.wd}${esc(suffix)}</p>`);
      } catch (e) {
        log.insertAdjacentHTML('beforeend', `<p class="err">❌ 週${p.wd}${esc(suffix)}：${esc(e.message)}</p>`);
      }
    }
    toast('完成'); setTimeout(route, 1200);
  };
}

async function renderSummary(orderId) {
  setNav('host');
  const s = await tool('get_order_summary', { order: orderId });
  const buyers = s.buyers || s.by_buyer || [];
  const byProduct = s.by_product || [];
  const lineText = l => `${esc(l.item || l.product)}${l.note ? `（${esc(l.note)}）` : ''} × ${l.qty}`;
  $app.innerHTML = `
    <p><a href="#/host">← 開團</a></p>
    <div class="card"><div class="row"><span class="big grow">${esc(s.shop_name || '')} ${esc(s.announcement || '')}</span>
      ${s.open !== false ? `<button id="close">截止</button>` : `<span class="pill">已截止</span>`}</div>
      <div class="muted">截止 ${esc(fmtTime(s.expire_at))} · 共 ${s.order_item_count ?? s.item_count ?? ''} 份 · ${money(s.order_total ?? s.total)}</div></div>
    <h2>按件統計（打給店家用）</h2>
    <div class="card"><table><tbody>${byProduct.map(p => `
      <tr><td>${esc(p.item || p.product)}${p.note ? `<div class="muted">${esc(p.note)}</div>` : ''}</td><td><b>${p.qty}</b></td>
      <td class="muted">${esc((p.buyers || []).map(b => typeof b === 'string' ? b : `${b.name}${b.qty > 1 ? '×' + b.qty : ''}`).join('、'))}</td></tr>`).join('')}</tbody></table>
      <button id="copy" style="margin-top:10px">複製清單</button></div>
    <h2>按人統計</h2>
    ${buyers.map(b => `<div class="card"><div class="row"><span class="grow big">${esc(b.name)}</span>
      <span class="muted">未付 ${money(b.unpaid)}</span>
      <button data-buyer="${esc(b.buyer_id)}" data-paid="${b.unpaid > 0}">${b.unpaid > 0 ? '標記已付' : '改回未付'}</button></div>
      <div class="muted">${(b.lines || []).map(lineText).join('、')}</div></div>`).join('') || '<p class="muted">還沒有人訂。</p>'}
    <details><summary class="muted">原始資料</summary><pre>${esc(JSON.stringify(s, null, 2))}</pre></details>`;

  $app.querySelector('#copy').onclick = () => {
    const text = byProduct.map(p => `${p.item || p.product}${p.note ? `（${p.note}）` : ''} ×${p.qty}`).join('\n');
    navigator.clipboard.writeText(text).then(() => toast('已複製'), () => toast('複製失敗'));
  };
  $app.querySelector('#close')?.addEventListener('click', async () => {
    if (!await ask('<p class="big">截止這張單？</p><p class="muted">截止後不能再訂，也不能重新開放。</p>', '截止')) return;
    try { await tool('close_order', { order: orderId }); toast('已截止'); route(); } catch (e) { toast(e.message); }
  });
  $app.addEventListener('click', async e => {
    const b = e.target.closest('[data-buyer]'); if (!b) return;
    b.disabled = true;
    try { await tool('set_paid', { order: orderId, buyer_id: b.dataset.buyer, paid: b.dataset.paid === 'true' }); route(); }
    catch (err) { toast(err.message); b.disabled = false; }
  });
}

// ---------- router ----------
async function route() {
  // Fresh node per view so listeners from the previous view don't pile up.
  const fresh = $app.cloneNode(false); $app.replaceWith(fresh); $app = fresh;
  if (!store.get('dbd.tokens')) return renderLogin();
  const [, view, id] = location.hash.replace(/^#\/?/, '#/').split('/');
  $app.innerHTML = `<p class="muted">載入中…</p>`;
  try {
    if (view === 'order' && id) await renderOrder(decodeURIComponent(id));
    else if (view === 'host' && id) await renderSummary(decodeURIComponent(id));
    else if (view === 'host') await renderHost();
    else await renderOrders();
  } catch (e) { showError(e); }
}

window.addEventListener('hashchange', route);
handleCallback().then(route, showError);
