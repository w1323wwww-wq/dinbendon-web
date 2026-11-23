# 公司訂便當

GitHub Pages 頁面，讓同事點 dinbendon 的團購單，也讓負責人一次開好下週的單。

```
瀏覽器（GitHub Pages）──► Cloudflare Worker ──► www.dinbendon.net/mvc/api（dinbendon 網站自己用的 JSON API）
                          · 以群組帳號身分呼叫（JWT 存在 KV）
                          · 每天 cron 續期 token
```

- 同事輸入**通關碼**和名字就能點，不需要 dinbendon 帳號。
- 每個瀏覽器有自己的訂購人識別碼（同 dinbendon 的 `dbd-owner-key`），只能取消自己訂的。
- 開團需要**管理碼**。
- Worker 只轉發固定幾個 API；不存密碼，只存群組帳號的 JWT。

## 設定（一次）

1. **設定通關碼和管理碼**（自己想兩組，管理碼別給同事）：
   ```sh
   cd worker
   npx wrangler secret put ACCESS_CODE
   npx wrangler secret put ADMIN_CODE
   ```
2. **放入群組帳號 token**：開頁面 → 輸入通關碼 → 「開團」→ 輸入管理碼 → 照畫面說明貼上 token。
   取得 token：用群組帳號登入 dinbendon，F12 → Console → `copy(localStorage.getItem('dbd-jwt'))`。
   token 有效 30 天，Worker 每天會嘗試續期；頁面會顯示剩幾天。
3. 把頁面網址和通關碼給同事。

## 改 Worker 之後重新部署

```sh
cd worker && npx wrangler deploy
```

## 限制

- 用的是 dinbendon 網站內部 API，沒有官方保證；網站改版可能要跟著改。
- 代訂、改價、標記付款、截止，請點「在 dinbendon 管理」到網站操作。
- 訂單如果要求填「訂購人資訊」，這個頁面送不出去，要到網站訂。

## 測試

```sh
node test.mjs
```
