import type {SupabaseClient} from '@supabase/supabase-js';
import {button,message,Message,Action} from './core';
export const KINDS=['任務','裝備','怪物'] as const;
const home=()=>button('回主選單',{a:'home'});
export function catalogCommand(text:string):URLSearchParams|null {
  const match=text.normalize('NFKC').trim().match(/^(任務|裝備|怪物)(?:查詢)?(?:[\s：:]+(.+))?$/u);
  if(!match)return null;
  return new URLSearchParams({a:match[2]?'catalog_search':'catalog',kind:match[1],q:match[2]?.trim()||''});
}
export async function catalogReply(db:SupabaseClient,p:URLSearchParams):Promise<Message[]> {
  const kind=p.get('kind')||'';
  if(!KINDS.includes(kind as typeof KINDS[number]))return [message('請重新選擇查詢種類。',[home()])];
  const a=p.get('a');
  if(a==='catalog'||a==='pending')return [message(`${kind}查詢｜請輸入「${kind} 名稱」\n可使用部分名稱或已收錄的別名。\n例如格式：${kind}：要查詢的名稱\n\n也可以點下方瀏覽已收錄資料。資料仍在整理，未收錄不代表遊戲中不存在。`,[button('瀏覽已收錄',{a:'catalog_search',kind}),home()])];
  const q=(p.get('q')||'').normalize('NFKC').trim();
  if(q.length>30)return [message('請將搜尋名稱縮短至 30 字以內。',[button('重新查詢',{a:'catalog',kind}),home()])];
  const rawPage=p.get('page')||'0';
  if(!/^\d{1,3}$/.test(rawPage))return [message('頁碼無效，請重新查詢。',[home()])];
  const page=Number(rawPage);
  const back=()=>button('返回結果',{a:'catalog_search',kind,q,page});
  const fail=(code?:string)=>[message(code==='42P01'||code==='PGRST205'?'查詢資料尚未啟用，請站長完成 v24 資料表設定。':'查詢暫時無法使用，請稍後再試。',[home()])];
  if(a==='catalog_detail'){
    const id=p.get('id')||'';
    if(!/^[0-9a-f-]{36}$/i.test(id))return [message('資料連結無效。',[home()])];
    const {data,error}=await db.from('line_guide_entries').select('name,summary,details,source_url,source_label,game_version,verified_at').eq('id',id).eq('kind',kind).eq('is_published',true).maybeSingle();
    if(error)return fail(error.code);
    if(!data)return [message('這筆資料已下架或尚未公開。',[back(),home()])];
    const actions:Action[]=[back(),home()];
    try {const u=new URL(data.source_url);if(u.protocol==='https:')actions.unshift({type:'uri',label:'查看資料來源',uri:u.href});}catch{}
    return [message(`${kind}｜${data.name}\n${data.summary}\n\n${data.details}\n\n適用版本：${data.game_version}\n來源：${data.source_label}\n核對日期：${data.verified_at}\n資料以標示版本為準。`,actions)];
  }
  // Search a single combined name/aliases column; never concatenate PostgREST filter expressions.
  let query=db.from('line_guide_entries').select('id,name,summary').eq('kind',kind).eq('is_published',true);
  if(q)query=query.ilike('search_text','%'+q.replace(/[\\%_]/g,'\\$&')+'%');
  const {data,error}=await query.order('name').order('id').range(page*8,page*8+8);
  if(error)return fail(error.code);
  const rows=(data||[]).slice(0,8);
  if(!rows.length)return [message(q?`${kind}｜尚未找到「${q}」。\n可以縮短名稱、換別名，或瀏覽已收錄資料。未收錄不代表遊戲中不存在。`:`${kind}｜${page?'這一頁沒有資料。':'目前尚無已核實並公開的資料，內容仍在整理。'}`,[button('瀏覽第一頁',{a:'catalog_search',kind}),button('重新查詢',{a:'catalog',kind}),home()])];
  const actions:Action[]=rows.map((r,i)=>button(`${i+1}. ${r.name}`.slice(0,20),{a:'catalog_detail',kind,id:r.id,q,page}));
  if(page)actions.push(button('上一頁',{a:'catalog_search',kind,q,page:page-1}));
  if((data||[]).length>8&&page<999)actions.push(button('下一頁',{a:'catalog_search',kind,q,page:page+1}));
  actions.push(button('重新查詢',{a:'catalog',kind}),home());
  return [message(`${kind}查詢｜第 ${page+1} 頁${q?'｜'+q:''}\n\n${rows.map((r,i)=>`${i+1}. ${r.name}\n${r.summary}`).join('\n\n')}\n\n點下方名稱查看詳情。`,actions)];
}
