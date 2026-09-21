import {createClient} from '@supabase/supabase-js';
import {randomUUID} from 'node:crypto';
import {Action,Boss,Message,SERVERS,button,message,identity,confirmationSignature,rankedTimers,timeLabel} from './core';

type Event={type:string; timestamp:number; replyToken?:string; source?:{type:string;userId?:string}; message?:{type:string;text?:string}; postback?:{data:string}};
const HOME=()=>button('回主選單',{a:'home'});
const ROOT=()=>message('楓伴小幫手｜請點選功能',[
  button('Boss刷新查詢',{a:'servers',m:'query'}),button('回報擊殺',{a:'servers',m:'report'}),button('我的收藏',{a:'favorites'}),
  button('任務查詢',{a:'pending',kind:'任務'}),button('裝備查詢',{a:'pending',kind:'裝備'}),button('怪物查詢',{a:'pending',kind:'怪物'})]);
export async function handleEvent(event:Event):Promise<Message[]>{
  if(!event.replyToken || !['message','postback','follow'].includes(event.type))return [];
  if(event.source?.type!=='user'||!event.source.userId)return [message('請開啟與楓伴小幫手的一對一聊天使用功能。')];
  const userId=event.source.userId;
  const secret=process.env.LINE_CHANNEL_SECRET!;
  const reporter=identity(userId,secret);
  const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
  let p=new URLSearchParams(event.postback?.data||'');
  if(event.type==='follow')return [ROOT()];
  if(event.type==='message'){
    const text=event.message?.text?.trim();
    const commands:Record<string,string>={'Boss刷新查詢':'a=servers&m=query','回報擊殺':'a=servers&m=report','我的收藏':'a=favorites','任務查詢':'a=pending&kind=任務','裝備查詢':'a=pending&kind=裝備','怪物查詢':'a=pending&kind=怪物'};
    p=new URLSearchParams(commands[text||'']||'a=home');
  }
  const a=p.get('a');
  if(a==='home')return [ROOT()];
  if(a==='pending')return [message(`${p.get('kind')||'此功能'}資料庫尚未接入，目前可使用王刷新查詢、回報擊殺與收藏王。`,[HOME()])];
  const m=p.get('m')==='report'?'report':'query';
  if(a==='servers')return [message('請選擇伺服器',SERVERS.map((s,i)=>button(s,{a:'bosses',s:i,m})))];
  if(a==='favorites'){
    const {data,error}=await db.from('line_boss_favorites').select('server,boss_key').eq('reporter_hash',reporter).order('created_at').limit(11);
    if(error)throw error;
    if(!data?.length)return [message('還沒有收藏。查詢王後，點「收藏這隻王」即可加入。',[button('查詢王',{a:'servers'}),HOME()])];
    const {data:defs,error:de}=await db.from('boss_definitions').select('boss_key,boss_name').eq('is_active',true);
    if(de)throw de;
    return [message('我的收藏｜點選即可查詢', [...data.filter(f=>defs?.some(b=>b.boss_key===f.boss_key)).map(f=>button(`${f.server}・${defs!.find(b=>b.boss_key===f.boss_key)!.boss_name}`.slice(0,20),{a:'query',s:SERVERS.indexOf(f.server),b:f.boss_key})),HOME()])];
  }
  const s=p.get('s');
  if(s!=='0'&&s!=='1')return [ROOT()];
  const server=SERVERS[Number(s)];
  const {data:bosses,error}=await db.from('boss_definitions').select('boss_key,boss_name,respawn_min_minutes,respawn_max_minutes,source_note').eq('is_active',true).order('sort_order');
  if(error)throw error;
  if(a==='bosses'){
    const page=Math.max(0,Math.min(100,Number(p.get('page'))||0));
    const options:Action[]=(bosses as Boss[]).slice(page*10,page*10+10).map(b=>button(b.boss_name.slice(0,20),{a:m==='report'?'ranges':'query',s,b:b.boss_key}));
    if(page>0)options.push(button('上一頁',{a:'bosses',s,m,page:page-1}));
    if(bosses.length>(page+1)*10)options.push(button('下一頁',{a:'bosses',s,m,page:page+1}));
    options.push(HOME());
    return [message(`${server}｜請選擇王`,options)];
  }
  const b=p.get('b')||'';
  const boss=(bosses as Boss[]).find(x=>x.boss_key===b);
  if(!boss)return [message('這隻王目前未開放，請重新選擇。',[HOME()])];
  const base={s,b};
  if(a==='favorite'||a==='unfavorite'){
    if(a==='favorite'){
      const {error:e}=await db.rpc('line_save_favorite',{p_reporter:reporter,p_server:server,p_boss:b});
      if(e) return [message('未能加入收藏（上限 10 隻）。請先移除其他收藏，或稍後再試。',[HOME()])];
    }else{
      const {error:e}=await db.from('line_boss_favorites').delete().eq('reporter_hash',reporter).eq('server',server).eq('boss_key',b);if(e)throw e;
    }
    return [message(a==='favorite'?'已加入收藏。':'已移除收藏。',[button('查詢這隻王',{a:'query',...base}),HOME()])];
  }
  if(a==='query'){
    const {data:timers,error:e}=await db.from('boss_timer_state').select('channel,defeated_at').eq('server',server).eq('boss_key',b);
    if(e)throw e;
    const now=Date.now();const ranked=rankedTimers(timers||[],boss,now);
    const lines=ranked.current.slice(0,3).map(t=>`${t.channel} 頻｜${t.start<=now?'已進入預估刷新區間':`約 ${Math.ceil((t.start-now)/60000)} 分後進入區間`}\n${timeLabel(t.start)}～${timeLabel(t.end)}\n回報擊殺：${timeLabel(Date.parse(t.defeated_at))}`);
    const text=`${server}｜${boss.boss_name}\n${lines.length?'預估最早刷新頻道\n\n'+lines.join('\n\n'):'目前沒有仍在預估時段內的紀錄。'}\n\n${ranked.expired?`${ranked.expired} 個頻道的紀錄已超過預估區間，狀態未確認。\n`:''}依玩家回報與網站設定推算，非即時偵測；不保證王仍在。\n參考：${boss.source_note||'網站目前設定'}\n查詢時間：${timeLabel(now)}`;
    return [message(text,[button('重新查詢',{a:'query',...base}),button('回報擊殺',{a:'ranges',...base}),button('收藏這隻王',{a:'favorite',...base}),button('移除收藏',{a:'unfavorite',...base}),{type:'uri',label:'開啟網站計時器',uri:'https://fengban.vercel.app/boss-timer'},HOME()])];
  }
  if(a==='ranges')return [message(`${server}｜${boss.boss_name}\n請選擇頻道範圍`,[...Array.from({length:6},(_,i)=>button(`${i*10+1}～${i*10+10} 頻`,{a:'channels',...base,r:i})),HOME()])];
  if(a==='channels'){
    const r=Number(p.get('r'));if(!Number.isInteger(r)||r<0||r>5)return [ROOT()];
    return [message('請選擇擊殺頻道',[...Array.from({length:10},(_,i)=>button(`${r*10+i+1} 頻`,{a:'time',...base,c:r*10+i+1})),button('重選範圍',{a:'ranges',...base}),HOME()])];
  }
  const c=Number(p.get('c'));if(!Number.isInteger(c)||c<1||c>60)return [ROOT()];
  if(a==='time')return [message(`${server}｜${boss.boss_name}｜${c} 頻\n什麼時候擊殺？`,[... [0,1,3,5,10].map(t=>button(t===0?'剛剛擊殺':`${t} 分鐘前`,{a:'confirm',...base,c,t})),HOME()])];
  if(a==='confirm'){
    const t=Number(p.get('t'));if(![0,1,3,5,10].includes(t))return [ROOT()];
    const at=event.timestamp-t*60000;
    const data=new URLSearchParams({a:'save',s,b,c:String(c),at:String(at),issued:String(event.timestamp),n:randomUUID()}).toString();
    const signature=confirmationSignature(data,userId,secret);
    return [message(`請確認回報\n${server}｜${boss.boss_name}｜${c} 頻\n擊殺時間：${timeLabel(at)}\n確認後會公開同步到網站計時器。`,[{type:'postback',label:'確認回報',displayText:'確認回報',data:data+'&sig='+signature},button('重新選擇',{a:'ranges',...base}),HOME()])];
  }
  if(a==='save'){
    const sig=p.get('sig');p.delete('sig');
    if(sig!==confirmationSignature(p.toString(),userId,secret))return [message('回報驗證失敗，請重新操作。',[HOME()])];
    const at=Number(p.get('at')), issued=Number(p.get('issued'));
    if(!Number.isFinite(at)||!Number.isFinite(issued)||Date.now()-issued>600000||issued>Date.now()+30000)return [message('確認按鈕已過期，請重新回報。',[button('回報擊殺',{a:'ranges',...base})])];
    const {data,error:e}=await db.rpc('line_record_boss_kill',{p_nonce:p.get('n'),p_reporter:reporter,p_server:server,p_boss:b,p_channel:c,p_at:new Date(at).toISOString()});
    if(e){
      if(e.message.includes('LINE_RATE_LIMIT'))return [message('回報太密集，請等 10 秒後再點確認。')];
      if(e.message.includes('LINE_STALE'))return [message('已有更新的擊殺紀錄，這次舊回報未覆蓋計時。',[button('查詢最新紀錄',{a:'query',...base})])];
      throw e;
    }
    return [message(`${data?.[0]?.was_duplicate?'已確認既有紀錄，未重複計時':'擊殺回報成功，已同步網站'}。\n${server}｜${boss.boss_name}｜${c} 頻\n紀錄時間：${timeLabel(Date.parse(data[0].defeated_at))}`,[button('查看刷新時間',{a:'query',...base}),HOME()])];
  }
  return [ROOT()];
}
