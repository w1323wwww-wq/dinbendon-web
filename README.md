# 公司訂便當

GitHub Pages 頁面，透過 dinbendon 官方 MCP（AI 應用連結，beta）讓同事點餐、讓負責人一次開好下週的單。

```
瀏覽器（GitHub Pages）──► Cloudflare Worker（CORS 轉發，不存資料）──► dinbendon.net/mcp
        └── OAuth 授權頁直接跳 dinbendon.net/oauth/authorize
```

- 每位同事用自己的 dinbendon **個人帳號**登入授權；token 只存在他自己的瀏覽器。
- Worker 只轉發 `/mcp` 和 `/oauth/token`，只接受 `ALLOWED_ORIGINS` 裡的來源。
- OAuth client 是公開用戶端（PKCE），`client_id` 就是 `client.json` 的網址。

## 部署

1. **建 GitHub repo** `dinbendon-web`，推上這個資料夾。Settings → Pages → Branch `main` / root。
   網址會是 `https://<你的帳號>.github.io/dinbendon-web/`。
2. **改 `client.json`**：把 3 個 `YOUR_GH_USER` 換成你的 GitHub 帳號。網址必須和實際網址完全一致（含結尾 `/`）。
3. **部署 Worker**（需要 Cloudflare 免費帳號）：
   ```sh
   cd worker
   # 先把 wrangler.toml 的 YOUR_GH_USER 換掉
   npx wrangler login
   npx wrangler deploy
   ```
   會印出 `https://dinbendon-proxy.<子網域>.workers.dev`。
4. **改 `config.js`** 的 `WORKER_URL` 成上一步的網址，commit、push。
5. 打開頁面 → 登入 dinbendon → 選群組 → 同意。

## 功能

- **點餐**：進行中的訂單 → 菜單（搜尋、分類、規格按鈕）→ 購物車加品項說明 → 送出；我訂的品項可改份數、改說明、取消。
- **開團**：選店家、勾下週哪幾天、每天截止時間 → 一次開好（公告寫「週X早餐」）；設定會記住。
- **我開的單**：按件統計（可複製給店家）、按人統計、標記付款、截止。

## 限制

- 只有個人帳號能用；群組管理員可以在管理中心關掉「允許成員連結 AI 應用」。
- 用這個頁面開的單，負責人一定顯示你的暱稱（MCP 沒有自訂負責人名稱），所以「週二早餐」放在公告。
- 代訂、改價、菜單外品項、改截止時間，要到 dinbendon 網站操作。
- dinbendon MCP 還在 beta，格式可能變動。

## 測試

```sh
node test.mjs
```
