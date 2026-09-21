import {randomUUID} from 'node:crypto';
import {verifySignature} from '@/lib/line/core';
import {handleEvent} from '@/lib/line/bot';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
// Log only allowlisted diagnostic fields: never raw errors, payloads or credentials.
function diagnostic(error:unknown){
  const e=error && typeof error==='object' ? error as Record<string,unknown> : {};
  const text=typeof e.message==='string'?e.message.toLowerCase():'';
  const code=typeof e.code==='string' && /^(?:[0-9A-Z]{5}|PGRST[0-9]{3})$/.test(e.code)?e.code:'UNKNOWN';
  const category=/invalid api key|invalid.*jwt|jwt.*expired|invalid.*token/.test(text)?'DB_AUTH'
    : /permission denied/.test(text)?'DB_PERMISSION'
    : /schema cache|does not exist|could not find/.test(text)?'DB_SCHEMA'
    : /fetch failed|network|timeout|timed out|abort/.test(text)?'NETWORK'
    : 'PROCESSING';
  return {code,category};
}
export async function POST(request:Request){
  const secret=process.env.LINE_CHANNEL_SECRET;
  const token=process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if(!secret||!token||!process.env.NEXT_PUBLIC_SUPABASE_URL||!process.env.SUPABASE_SERVICE_ROLE_KEY)return new Response('Configuration incomplete',{status:503});
  const raw=await request.text();
  if(!verifySignature(raw,request.headers.get('x-line-signature'),secret))return new Response('Invalid signature',{status:401});
  let body;
  try {body=JSON.parse(raw);}catch{return new Response('Invalid JSON',{status:400});}
  if(!body||!Array.isArray(body.events)||body.events.length>100)return new Response('Invalid events',{status:400});
  let failed=false;
  for(const event of body.events){
    if(!event||typeof event.type!=='string')continue;
    let phase='handle_event';
    try{
      const messages=await handleEvent(event);
      if(!messages.length)continue;
      phase='line_reply';
      const response=await fetch('https://api.line.me/v2/bot/message/reply',{
        method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
        body:JSON.stringify({replyToken:event.replyToken,messages}),signal:AbortSignal.timeout(10000)
      });
      // A retried event can carry a reply token that was already consumed.
      // Only this explicit error is acknowledged; other errors remain retryable.
      if(!response.ok){
        const error=await response.json().catch(()=>({}));
        if(response.status===400&&error.message==='Invalid reply token')continue;
        console.error('LINE reply failed',response.status);failed=true;
      }
    }catch(error){
      const ref=randomUUID().slice(0,8);
      const detail=diagnostic(error);
      const action=new URLSearchParams(event.postback?.data||'').get('a');
      const safeAction=['bosses','query','ranges','channels','time','confirm','save','favorites','favorite','unfavorite'].includes(action||'')?action:'other';
      console.error('LINE event processing failed',JSON.stringify({version:'v23.1',ref,phase,action:safeAction,...detail}));
      failed=true;
      // Keep HTTP 500 so LINE can redeliver; report writes already use idempotent receipts.
      if(event.replyToken && phase==='handle_event'){
        try{
          const fallback=await fetch('https://api.line.me/v2/bot/message/reply',{
            method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
            body:JSON.stringify({replyToken:event.replyToken,messages:[{type:'text',text:`暫時無法完成操作，請稍後再試。\n錯誤代碼：${detail.category}/${detail.code}\n查詢編號：${ref}`}]}),
            signal:AbortSignal.timeout(10000)
          });
          if(!fallback.ok)console.error('LINE diagnostic reply failed',fallback.status);
        }catch{console.error('LINE diagnostic reply unavailable');}
      }
    }
  }
  return new Response(failed?'Retry later':'OK',{status:failed?500:200});
}
