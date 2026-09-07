楓伴 v16｜404 緊急修復包

原因：
最新 GitHub commit 把 app/page.tsx 刪掉了，所以 Vercel 雖然部署成功，
但首頁沒有 "/" 路由，才會直接顯示 404。

修復方式：
1. 把這個 ZIP 解壓縮。
2. 將 ZIP 內的 app 與 public 資料夾「合併」到 fengban 專案根目錄。
3. 不要刪除原本整個 app / public 資料夾。
4. 確認專案內一定存在：
   app/page.tsx
   app/icon.png
   app/apple-icon.png
   app/favicon.ico
   public/fengban-icon.png
5. GitHub Desktop 應該會看到 app/page.tsx 被新增回來。
6. Commit：修復首頁 404 並恢復 v16
7. Push origin。

Supabase：
v16 SQL 已經成功執行，不需要重跑。

另外：
你目前 GitHub 裡有 icon.png.png / apple-icon.png.png 這種雙副檔名檔案，
它們不是這次 404 的主因；先把首頁救回來，之後再清理即可。
