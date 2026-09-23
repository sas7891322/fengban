const {test,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const dir=fs.mkdtempSync(path.join(__dirname,'.catalog-'));
for(const name of ['core','catalog'])fs.writeFileSync(path.join(dir,name+'.js'),ts.transpileModule(fs.readFileSync(path.join(__dirname,'../lib/line',name+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText);
after(()=>fs.rmSync(dir,{recursive:true,force:true}));
const {catalogCommand,catalogReply}=require(path.join(dir,'catalog.js'));
function mock(data,error=null){const calls=[];const q={};for(const method of ['select','eq','ilike','order','range','maybeSingle'])q[method]=(...args)=>{calls.push([method,...args]);return q;};q.then=(a,b)=>Promise.resolve({data,error}).then(a,b);return {calls,from:()=>q};}
test('commands accept colon, spaces, full width and category menus',()=>{
 for(const s of ['裝備：雨傘','裝備 雨傘','裝備查詢：雨傘'])assert.equal(catalogCommand(s).get('q'),'雨傘');
 assert.equal(catalogCommand('任務查詢').get('a'),'catalog');assert.equal(catalogCommand('其他'),null);
});
test('search escapes wildcard characters, paginates and exposes source on detail',async()=>{
 const db=mock(Array.from({length:9},(_,i)=>({id:'11111111-1111-4111-8111-111111111111',name:'測試'+i,summary:'測試摘要'})));
 const r=await catalogReply(db,catalogCommand('怪物 測試%_'));
 assert.match(r[0].text,/第 1 頁/);assert.ok(r[0].quickReply.items.length<=13);
 assert.ok(db.calls.some(c=>c[0]==='eq'&&c[1]==='is_published'&&c[2]===true));
 assert.ok(db.calls.some(c=>c[0]==='ilike'&&c[2]==='%測試\\%\\_%'));
 assert.ok(r[0].quickReply.items.some(i=>i.action.label==='下一頁'));
 const detail=mock({name:'測試',summary:'摘要',details:'詳情',source_url:'https://example.org',source_label:'來源',game_version:'測試版本',verified_at:'2026-09-21'});
 const d=await catalogReply(detail,new URLSearchParams(r[0].quickReply.items[0].action.data));assert.match(d[0].text,/詳情/);assert.equal(d[0].quickReply.items[0].action.type,'uri');
});
test('empty data, missing migration, withdrawn detail and long input give safe feedback',async()=>{
 assert.match((await catalogReply(mock([]),catalogCommand('任務 未知')))[0].text,/未收錄不代表/);
 assert.match((await catalogReply(mock(null,{code:'PGRST205'}),catalogCommand('任務 未知')))[0].text,/v24/);
 assert.match((await catalogReply(mock(null),new URLSearchParams('a=catalog_detail&kind=任務&id=11111111-1111-4111-8111-111111111111')))[0].text,/已下架/);
 const db=mock([]);assert.match((await catalogReply(db,catalogCommand('任務 '+ '甲'.repeat(31))))[0].text,/30 字/);assert.equal(db.calls.length,0);
});
