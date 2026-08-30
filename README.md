# 楓伴正式版骨架

Next.js + Supabase + Vercel。

## 已完成
- 五大首頁入口與原本確認的插圖
- Supabase Email Magic Link 登入
- 會員多角色資料
- 多人共用刊登
- 我的刊登
- 刪除自己的刊登
- Supabase RLS 權限
- 手機版 RWD

## Supabase
1. 建立新 Supabase Project。
2. 到 SQL Editor 執行 `supabase/schema.sql`。
3. Authentication → URL Configuration，把正式 Vercel 網址設成 Site URL，Redirect URLs 加入正式網址與 `http://localhost:3000`。
4. 複製 `.env.example` 為 `.env.local`，填入 `NEXT_PUBLIC_SUPABASE_URL` 與 `NEXT_PUBLIC_SUPABASE_ANON_KEY`。

> 不要把 service_role key 放進前端。

## 本機
```bash
npm install
npm run dev
```

## Vercel
GitHub 匯入專案後，在 Environment Variables 加入相同兩個 `NEXT_PUBLIC_...` 變數後部署。

## 下一階段
- 各分類專用欄位
- 編輯刊登
- 到期自動隱藏
- 聯絡／我有興趣流程
- 檢舉與封鎖
- 管理後台
