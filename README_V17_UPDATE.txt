楓伴 v17｜刊登留言數更新

新增：
- 每篇刊登的留言按鈕顯示留言數，例如：💬 留言（3）
- 打開留言視窗後，標題也會顯示目前留言數
- 新增留言、刪除留言、管理員隱藏留言後，數字會同步更新
- 只計算 active 留言，已隱藏留言不會算進去

更新順序：
1. 到正確的 fengban Supabase → SQL Editor
2. 執行 supabase/fengban_v17_comment_counts.sql
3. 把 app/page.tsx 覆蓋到專案
4. GitHub Desktop Commit：新增刊登留言數顯示
5. Push origin

v16 留言 SQL 不需要重跑。
