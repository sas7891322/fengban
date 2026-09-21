import {createHmac, timingSafeEqual} from 'node:crypto';

export const SERVERS = ['菇菇寶貝', '雪吉拉'] as const;
export type Boss = {boss_key:string; boss_name:string; respawn_min_minutes:number; respawn_max_minutes:number; source_note:string};
export type Timer = {channel:number; defeated_at:string};
export type Action = {type:'postback'; label:string; data:string; displayText:string} | {type:'uri'; label:string; uri:string};
export type Message = {type:'text'; text:string; quickReply?:{items:{type:'action'; action:Action}[]}};
export function message(text:string, actions:Action[]=[]):Message {
  if(actions.length>13) throw new Error('Too many quick replies');
  return {type:'text', text, ...(actions.length?{quickReply:{items:actions.map(action=>({type:'action',action}))}}:{})};
}
export function button(label:string, values:Record<string,string|number>):Action {
  return {type:'postback', label, displayText:label, data:new URLSearchParams(Object.entries(values).map(([k,v])=>[k,String(v)])).toString()};
}
export function verifySignature(body:string, signature:string|null, secret:string):boolean {
  if(!signature||!secret) return false;
  const expected=createHmac('sha256',secret).update(body).digest('base64');
  const a=Buffer.from(expected), b=Buffer.from(signature);
  return a.length===b.length && timingSafeEqual(a,b);
}
export function identity(userId:string, secret:string):string {
  return createHmac('sha256',secret).update('reporter:'+userId).digest('hex');
}
export function confirmationSignature(data:string, userId:string, secret:string):string {
  return createHmac('sha256',secret).update(userId+'|'+data).digest('base64url');
}
export function timeLabel(ms:number):string {
  return new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(ms);
}
export function rankedTimers(timers:Timer[],boss:Boss,now:number) {
  const rows=timers.map(t=>({...t,start:Date.parse(t.defeated_at)+boss.respawn_min_minutes*60000,end:Date.parse(t.defeated_at)+boss.respawn_max_minutes*60000}))
    .filter(t=>Number.isFinite(t.start)&&Date.parse(t.defeated_at)<=now);
  return {current:rows.filter(t=>t.end>=now).sort((a,b)=>a.start-b.start||a.channel-b.channel),expired:rows.filter(t=>t.end<now).length};
}
