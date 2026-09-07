-- 楓伴 v17：刊登留言數
-- 只回傳 active 留言的聚合數量，不暴露留言內容或使用者資料。

create or replace function public.get_fengban_comment_counts()
returns table (
  listing_id uuid,
  comment_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.listing_id,
    count(*)::bigint as comment_count
  from public.listing_comments c
  where c.status = 'active'
  group by c.listing_id;
$$;

revoke all on function public.get_fengban_comment_counts() from public;
grant execute on function public.get_fengban_comment_counts() to anon, authenticated;
