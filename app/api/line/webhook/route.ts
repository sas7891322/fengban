import {verifySignature} from '@/lib/line/core';
import {handleEvent} from '@/lib/line/bot';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
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
    try{
      const messages=await handleEvent(event);
      if(!messages.length)continue;
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
    }catch{console.error('LINE event processing failed');failed=true;}
  }
  return new Response(failed?'Retry later':'OK',{status:failed?500:200});
}
