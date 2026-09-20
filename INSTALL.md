# 楓伴 BOSS 王計時 v3｜社群實測版

這版依照目前討論的流程製作：

**玩家只做：選王 → 選頻道 → 按「王已消滅」**

不需要輸入文字、不需要下拉、不需要選重生時間，也不需要王出現後再按「已重生」。

## 這版的核心邏輯

1. 王的目前參考重生區間存在 `boss_definitions`。
2. 玩家按「王已消滅」後，透過 `record_boss_kill()` RPC 建立事件並開始倒數。
3. 同一隻王＋同一頻道 10 分鐘內有多人按擊殺，系統視為**同一輪**，只增加確認玩家，不建立重複週期。
4. 下一次同王同頻道再被擊殺時，系統自動記錄「兩次擊殺間隔」。
5. 楓伴原本 `admin_users` 裡的官方／管理員帳號，會在王計時頁看到「📊 官方統計」。
6. 官方統計會顯示：擊殺事件、參與玩家、有效週期、最短、P10、中位數、P90、平均、5 分鐘區間分布。

> 注意：兩次擊殺間隔 = 真正重生時間 + 玩家發現王／打死王花掉的時間，所以系統不會只拿平均值當作重生時間。官方後台會保留分布，之後可用大量資料校正真正區間。

## 目前測試範圍

- 伺服器先固定：**菇菇寶貝**
- 頻道：CH1～CH60
- 王：目前版本 8 隻野王
- 殭屍蘑菇王初始參考值：**45～55 分鐘**（依站長實測）

## 安裝

將下列檔案合併到目前 `fengban` 專案：

- `app/boss-timer/page.tsx`
- `app/BossTimerShortcut.tsx`
- `app/layout.tsx`
- `supabase/fengban_v19_boss_timer_community.sql`

然後到 Supabase → SQL Editor 執行：

`supabase/fengban_v19_boss_timer_community.sql`

最後重新部署 Vercel。

## 如果之前已經執行 v18

v19 使用新的資料表：

- `boss_definitions`
- `boss_kill_events`
- `boss_kill_confirmations`
- `boss_timer_state`

所以不需要先刪除 v18 的 `boss_timers`。等 v3 確認沒問題後再清理舊表即可。

## 官方帳號

主站目前已經用 `admin_users` 判斷管理員，因此這版沿用同一套權限。

如果你的官方帳號本來就已經能開啟楓伴「管理員審核」，王計時頁就會自動出現「📊 官方統計」。
