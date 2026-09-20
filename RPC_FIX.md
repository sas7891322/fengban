# v3.3 RPC 修正

如果畫面出現：

`Could not find the function public.record_boss_kill(...) in the schema cache`

代表前端已部署，但 Supabase 尚未建立/更新王擊殺 RPC，或 PostgREST schema cache 尚未刷新。

## 修正方式

1. 打開 Supabase 專案。
2. 進入 SQL Editor。
3. 開啟 `supabase/fengban_v20_boss_timer_rpc_fix.sql`。
4. 全選並 Run。
5. 重新整理 `/boss-timer`。

這份 SQL 可以重複執行，會：
- 建立/補齊王資料表
- 建立 8 隻王初始資料
- 重建 `record_boss_kill`
- 將 RPC 參數順序對齊前端
- 授權 authenticated 使用者執行
- 強制 Supabase API reload schema cache
