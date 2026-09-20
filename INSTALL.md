# 楓伴 BOSS 王計時 v1 安裝

目前 GitHub App 對 `sas7891322/fengban` 的寫入被 GitHub 回覆 403，因此這份資料夾是可直接合併進目前專案的版本。

## 1. 複製檔案

把以下檔案放進 repo 相同路徑：

- `app/boss-timer/page.tsx`（新增）
- `app/BossTimerShortcut.tsx`（新增）
- `app/layout.tsx`（覆蓋目前 layout；只多了王計時入口）
- `supabase/fengban_v18_boss_timers.sql`（新增）

## 2. 初始化 Supabase

進 Supabase → SQL Editor，完整執行：

`supabase/fengban_v18_boss_timers.sql`

這會建立：

- `boss_timers` 共用資料表
- RLS 權限
- 同伺服器＋BOSS＋頻道唯一限制
- Realtime 即時更新

## 3. 部署

提交到 GitHub 後讓 Vercel 正常重新部署即可。

## v1 功能

- 訪客可查看所有王計時
- 登入會員可新增／更新計時
- 同一伺服器＋BOSS＋頻道共用同一筆計時
- 支援固定重生（最早＝最晚）
- 支援區間重生（最早＜最晚）
- 「剛剛擊殺」一鍵重新開始倒數
- 即時顯示倒數、重生區間、可能已重生
- Supabase Realtime + 30 秒備援刷新
- 建立者可刪除自己建立的計時
- 手機版可用

## 後續可加

- 官方／社群確認過的王重生時間預設值
- 王圖示與地圖圖示
- 剩 5 分鐘瀏覽器通知
- Discord 通知
- 擊殺歷史紀錄
- 依頻道快速巡王模式
