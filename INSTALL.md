# 楓伴 BOSS 王計時 v2（全點選版）

這版把新增計時改成手機友善的「全按鈕點選」流程，不需要輸入文字，也不需要下拉選單。

## 操作流程

1. 點 BOSS：紅寶王／樹妖王／殭屍猴王／巨居蟹／蘑菇王／沼澤巨鱷／殭屍蘑菇王／巴洛古
2. 點伺服器：菇菇寶貝／雪吉拉
3. 點頻道：CH1～CH60
4. 點重生規則：30、45、60、90 分、2 小時、3 小時、45～90 分、3～4 小時
5. 點擊殺時間：剛剛／5／10／15／30 分前
6. 點「開始／更新這隻王的計時」

目前不把各王重生規則直接寫死，因為經典版社群回報仍有版本差異；等確認各隻王的固定重生時間後，可以再改成「點 BOSS 後自動帶入」，屆時甚至能省掉第 4 步。

## 安裝

把檔案合併進既有 `fengban` 專案：

- `app/boss-timer/page.tsx`
- `app/BossTimerShortcut.tsx`
- `app/layout.tsx`
- `supabase/fengban_v18_boss_timers.sql`

如果 v1 的 SQL 已執行過，不需要重跑資料表 SQL；v2 只改前端操作方式。

第一次安裝才需要到 Supabase SQL Editor 執行：

`supabase/fengban_v18_boss_timers.sql`

之後重新部署 Vercel 即可。
