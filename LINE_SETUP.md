## v23.1 診斷更新

若選伺服器後沒有回覆，請更新 `app/api/line/webhook/route.ts` 並部署。
此版在 Vercel Logs 記錄 v23.1、查詢編號、處理階段、按鈕動作、錯誤分類與資料庫代碼，不記錄原始錯誤、金鑰或使用者內容。
LINE 也會收到安全的錯誤提示。這是診斷更新，不代表根因已修復。
不需變更環境變數或執行 SQL。部署 Ready 後，點「Boss刷新查詢」→伺服器，再提供錯誤代碼或對應 Logs。

# 楓伴 v23：LINE 王查詢與回報

這份更新包已加入程式，尚未替你部署，也尚未連上你的正式 LINE / Supabase 驗證。

## 已完成的功能

- 沿用既有圖文選單文字：Boss刷新查詢、回報擊殺、我的收藏。
- LINE 一對一聊天室點選伺服器 → 王 → 查詢預計最早刷新的前三個頻道。
- 回報：王 → 頻道範圍 → 頻道 → 剛剛／1、3、5、10 分鐘前 → 確認。
- 查詢、回報與網站共用 boss_definitions、boss_kill_events、boss_timer_state。
- 收藏最多 10 組伺服器＋王，可新增、移除與再次查詢。
- 同輪 10 分鐘內回報合併，重按同一確認按鈕不新增擊殺；確認按鈕 10 分鐘後過期，每個 LINE 回報者限每 10 秒一次。
- 原本網站登入回報仍可用。LINE 玩家不自動取得網站會員或管理員權限。
- 王刷新數值沿用資料庫，未重新考證遊戲設定。超過預估區間的紀錄另計為未確認，不當成王一定存在。
- 管理員統計加入 LINE 確認者；同一人使用網站與 LINE 會被視為兩個身分，尚未做帳號綁定。
- 任務／裝備／怪物按鈕會明確回覆資料庫尚未接入，不提供虛構搜尋結果。這三項仍需後续建立資料庫。

## 手機部署順序

1. **Supabase**：用 Safari 開啟你楓伴網站原本的 Supabase 專案，進入 SQL Editor。貼上 `supabase/fengban_v23_line_bot.sql` 全文並 Run。這份遷移建立在原本 v19～v22 王計時表上，請勿在空白專案執行。不要為此重跑會重設王刷新設定的 v19。
2. **程式**：把更新包解壓縮到 iPhone「檔案」，將程式更新到原本 Vercel 連結的 GitHub 儲存庫。儲存庫根目錄必須直接有 `package.json`、`app`、`lib`，不可多套一層 fengban-main。
3. **Vercel**：楓伴專案 → Settings → Environment Variables，加入下列三項到 Production（測試部署若需要，另加 Preview）。原本兩個 NEXT_PUBLIC_SUPABASE 設定保留。加入後重新部署，讓部署讀到新變數。

| 名稱 | 值從哪裡取得 |
| --- | --- |
| LINE_CHANNEL_SECRET | LINE Developers → 楓伴小幫手 → Basic settings → Channel secret |
| LINE_CHANNEL_ACCESS_TOKEN | LINE Developers → Messaging API → 剛核發的 Channel access token |
| SUPABASE_SERVICE_ROLE_KEY | 原本楓伴 Supabase 專案 API Keys 中的 service_role 伺服器金鑰，非 anon key |

金鑰直接貼進 Vercel，勿貼聊天、程式碼或前端欄位。Production 與 Preview 若都指同一資料庫，測試回報也會進正式紀錄。

4. 部署成功後，LINE Developers → Messaging API → Webhook URL 填：

   `https://fengban.vercel.app/api/line/webhook`

5. 點 Verify，應顯示 Success，再開啟 Use webhook 與 Webhook redelivery。簽章驗證依 LINE 官方規範先驗證原始 request body，再處理事件： https://developers.line.biz/en/docs/messaging-api/receiving-messages/
6. LINE Official Account Manager → 回應設定：關閉會和機器人重複回答的「自動回應訊息」。歡迎訊息可選擇保留，但此程式也會在新朋友加入時回主選單，若只想收到一次可關閉原本歡迎訊息。
7. 你的圖文選單之前預約從 2026/09/22 開始；想立即測試，請把使用期間開始時間改為現在之前。也可先在聊天傳一次「Boss刷新查詢」測試，之後均可點選。

## 上線驗收

- 查詢兩個伺服器，未回報的王應顯示沒有有效紀錄。
- 用**真實擊殺**試一筆，確認 LINE 顯示成功且網站同王同頻道更新。請勿將假測試紀錄寫入正式共用資料庫。
- 再按同一個確認，應提示既有紀錄，不重設時間。
- 收藏王 → 我的收藏 → 查詢 → 移除收藏。
- 網站登入回報後，LINE 再查詢應看到同一筆資料。
- 不可把只有金鑰核發或 Webhook Verify 成功視為以上流程已驗證。

## 限制與故障排除

- 無撤銷回報介面，誤報目前需管理員處理資料；確認時請核對伺服器、王、頻道。
- 回報者識別採 Channel secret 的 HMAC 雜湊，不儲存 LINE 顯示名稱或原始 user ID。輪替 Channel secret 會使既有收藏身分失聯；輪替前應規劃遷移。
- 400：檢查 Webhook 設定是否指到正確路由；401：檢查 Channel secret；503：檢查三個新環境變數與 Supabase URL，重新部署。
- 500：檢查 v23 SQL 是否已執行、service_role 是否來自同一 Supabase 專案，以及 Vercel 函式日誌。日誌不輸出 token、原始事件或 user ID。
- 本程式只使用回覆訊息，不主動群發。未處理完成的事件回傳失敗供 LINE 重送；回報寫入有資料庫原子去重。

## 開發驗證

`npm ci` → `npm run test:line` → `npm run build`。
SQL 邏輯測試需另外在隔離的 PostgreSQL 或 PGlite 測試環境執行，不要在正式資料庫跑測試資料。

驗證紀錄：Next.js 正式編譯通過；7 項程式測試與 16 項隔離 PGlite 資料庫檢查通過。未執行正式 LINE / Supabase 端到端測試。
如需重跑隔離 SQL 測試：`npm install --no-save --package-lock=false @electric-sql/pglite`，再執行 `node tests/line-sql.mjs`。測試在記憶體資料庫運行，不連正式 Supabase。
