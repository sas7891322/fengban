const assert=require('node:assert/strict');
const {test,after}=require('node:test');
const {createHmac}=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const dir=fs.mkdtempSync(path.join(__dirname,'.line-test-'));
for(const name of ['core','bot'])fs.writeFileSync(path.join(dir,name+'.js'),ts.transpileModule(fs.readFileSync(path.join(__dirname,'../lib/line',name+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText);
const route=fs.readFileSync(path.join(__dirname,'../app/api/line/webhook/route.ts'),'utf8').replaceAll('@/lib/line/','./');
fs.writeFileSync(path.join(dir,'route.js'),ts.transpileModule(route,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText);
after(()=>fs.rmSync(dir,{recursive:true,force:true}));
const core=require(path.join(dir,'core.js'));
const {POST}=require(path.join(dir,'route.js'));
const {handleEvent}=require(path.join(dir,'bot.js'));
process.env.LINE_CHANNEL_SECRET='test-secret';process.env.LINE_CHANNEL_ACCESS_TOKEN='test-token';
process.env.NEXT_PUBLIC_SUPABASE_URL='https://example.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='test-service';
const boss={respawn_min_minutes:45,respawn_max_minutes:55};
const now=Date.parse('2026-09-21T04:00:00Z');
const timer=(channel,age)=>({channel,defeated_at:new Date(now-age*60000).toISOString()});
const base={timestamp:now,replyToken:'test',source:{type:'user',userId:'Utest'}};
test('LINE signature must match exact original bytes',()=>{
 const raw='{"events":[]}';const sig=createHmac('sha256','test-secret').update(raw).digest('base64');
 assert.ok(core.verifySignature(raw,sig,'test-secret'));
 assert.equal(core.verifySignature(raw+' ',sig,'test-secret'),false);
 assert.equal(core.verifySignature(raw,null,'test-secret'),false);
 assert.equal(core.verifySignature(raw,'x','test-secret'),false);
});
test('ranking excludes stale and future kill records; active windows precede countdowns',()=>{
 const r=core.rankedTimers([timer(1,60),timer(2,20),timer(3,50),timer(4,-1)],boss,now);
 assert.deepEqual(r.current.map(x=>x.channel),[3,2]);assert.equal(r.expired,1);
 assert.equal(core.rankedTimers([timer(5,45)],{...boss,respawn_max_minutes:45},now).current.length,1);
});
test('confirmation bound to user, channel, time and nonce',()=>{
 const data='a=save&c=1&at=123&n=nonce';const sig=core.confirmationSignature(data,'u1','s');
 assert.notEqual(sig,core.confirmationSignature(data,'u2','s'));
 assert.notEqual(sig,core.confirmationSignature(data.replace('c=1','c=2'),'u1','s'));
 assert.notEqual(core.identity('u1','s'),core.identity('u2','s'));
});
test('webhook verify accepts signed empty events; rejects unsigned payload without processing',async()=>{
 const raw='{"events":[]}';const signature=createHmac('sha256','test-secret').update(raw).digest('base64');
 assert.equal((await POST(new Request('https://example.test',{method:'POST',body:raw}))).status,401);
 assert.equal((await POST(new Request('https://example.test',{method:'POST',body:raw,headers:{'x-line-signature':signature}}))).status,200);
});
test('six entry points and server selection work without database calls',async()=>{
 const home=await handleEvent({...base,type:'follow'});assert.equal(home[0].quickReply.items.length,6);
 const servers=await handleEvent({...base,type:'message',message:{type:'text',text:'Boss刷新查詢'}});
 assert.deepEqual(servers[0].quickReply.items.map(i=>i.action.label),['菇菇寶貝','雪吉拉']);
 const pending=await handleEvent({...base,type:'message',message:{type:'text',text:'裝備查詢'}});
 assert.match(pending[0].text,/尚未接入/);
});
test('button payload stays within LINE limits, datetime uses Taipei',()=>{
 const b=core.button('測試',{a:'confirm',s:0,b:'zombie_mushmom',c:60,t:10});assert.ok(b.data.length<=300);
 assert.throws(()=>core.message('x',Array(14).fill(b)));
 assert.match(core.timeLabel(now),/12:00/);
});
test('tap flow from server to boss, channel and signed confirmation reaches shared RPC',async()=>{
 const oldFetch=global.fetch;let written;
 const liveBase={...base,timestamp:Date.now()};
 const def={boss_key:'mushmom',boss_name:'蘑菇王',respawn_min_minutes:45,respawn_max_minutes:60,source_note:'test'};
 global.fetch=async(input,init)=>{
  const url=String(input);
  if(url.includes('/boss_definitions'))return Response.json([def]);
  if(url.includes('/rpc/line_record_boss_kill')){
   written=JSON.parse(init.body);return Response.json([{event_id:'test-event',defeated_at:written.p_at,was_duplicate:false}]);
  }
  if(url.includes('/boss_timer_state'))return Response.json([{channel:60,defeated_at:new Date(Date.now()-50*60000).toISOString()}]);
  throw new Error('Unexpected request '+url);
 };
 const tap=async(data,userId='Utest')=>(await handleEvent({...liveBase,type:'postback',source:{type:'user',userId},postback:{data}}))[0];
 try{
  const bosses=await tap('a=bosses&s=0&m=report');
  const ranges=await tap(bosses.quickReply.items[0].action.data);
  const channels=await tap(ranges.quickReply.items[5].action.data);
  assert.equal(channels.quickReply.items[9].action.label,'60 頻');
  const times=await tap(channels.quickReply.items[9].action.data);
  const confirm=await tap(times.quickReply.items[0].action.data);
  const payload=confirm.quickReply.items[0].action.data;
  assert.ok(payload.length<=300);assert.match(confirm.text,/公開同步/);
  assert.match((await tap(payload,'another-user')).text,/驗證失敗/);assert.equal(written,undefined);
  assert.match((await tap(payload.replace('c=60','c=59'))).text,/驗證失敗/);assert.equal(written,undefined);
  assert.match((await tap(payload)).text,/已同步網站/);
  assert.equal(written.p_server,'菇菇寶貝');assert.equal(written.p_channel,60);assert.equal(written.p_boss,'mushmom');
  assert.equal(written.p_reporter,core.identity('Utest','test-secret'));
  const query=await tap('a=query&s=0&b=mushmom');assert.match(query.text,/60 頻/);assert.match(query.text,/已進入預估刷新區間/);
 }finally{global.fetch=oldFetch;}
});
