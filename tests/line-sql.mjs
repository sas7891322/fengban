import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const db=new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;
create publication supabase_realtime;`);
const root='../supabase/';
for(const f of ['fengban_v19_boss_timer_community.sql','fengban_v20_boss_timer_rpc_fix.sql','fengban_v21_boss_timer_defeated_at_fix.sql','fengban_v22_boss_timer_event_id_fix.sql','fengban_v23_line_bot.sql']){
 await db.exec(fs.readFileSync(new URL(root+f,import.meta.url),'utf8').replace('create extension if not exists pgcrypto;',''));
}
// Migration is repeatable and preserves definitions.
await db.exec(fs.readFileSync(new URL(root+'fengban_v23_line_bot.sql',import.meta.url),'utf8'));
await db.exec("set request.jwt.claim.role='service_role'");
let passed=0;
const report=async(nonce,user,ch,age=0)=>db.query('select * from public.line_record_boss_kill($1,$2,$3,$4,$5,now()-$6::interval)',[nonce,user,'菇菇寶貝','mushmom',ch,`${age} minutes`]);
const user='a'.repeat(64), nonce=randomUUID();
const first=(await report(nonce,user,1)).rows[0];assert.equal(first.was_duplicate,false);passed++;
const retry=(await report(nonce,user,1)).rows[0];assert.equal(retry.event_id,first.event_id);assert.equal(retry.was_duplicate,true);passed++;
await assert.rejects(report(randomUUID(),user,2),/LINE_RATE_LIMIT/);passed++;
const another=(await report(randomUUID(),'b'.repeat(64),1)).rows[0];assert.equal(another.event_id,first.event_id);assert.equal(another.was_duplicate,true);passed++;
assert.equal((await db.query('select count(*)::int n from boss_timer_state where channel=1')).rows[0].n,1);passed++;
await assert.rejects(report(randomUUID(),'c'.repeat(64),1,15),/LINE_STALE/);passed++;
await assert.rejects(report(randomUUID(),'d'.repeat(64),61),/Invalid location/);passed++;
await assert.rejects(report(randomUUID(),'e'.repeat(64),2,-10),/Invalid time/);passed++;
await assert.rejects(report(nonce,'f'.repeat(64),1),/Invalid receipt/);passed++;
// Website authenticated reports and LINE reports merge into the same round.
const uid=randomUUID();
await db.query('insert into auth.users(id) values($1)',[uid]);
await db.exec(`set request.jwt.claim.sub='${uid}'; set request.jwt.claim.role='authenticated'`);
const website=(await db.query("select * from record_boss_kill('mushmom',1,'菇菇寶貝')")).rows[0];
assert.equal(website.event_id,first.event_id);assert.equal(website.was_duplicate,true);passed++;
await assert.rejects(report(randomUUID(),'g'.repeat(64),2),/Forbidden/);passed++;
// Verify grants actually prevent public invocation and private table reads.
assert.equal((await db.query("select has_function_privilege('anon','public.line_record_boss_kill(uuid,text,text,text,integer,timestamptz)','execute') ok")).rows[0].ok,false);passed++;
assert.equal((await db.query("select has_table_privilege('anon','line_boss_favorites','select') ok")).rows[0].ok,false);passed++;
await db.exec("set request.jwt.claim.role='service_role'");
const favUser='9'.repeat(64);
const defs=(await db.query('select boss_key from boss_definitions')).rows;
const all=['菇菇寶貝','雪吉拉'].flatMap(s=>defs.map(b=>[s,b.boss_key]));
for(const [s,b] of all.slice(0,10))await db.query('select line_save_favorite($1,$2,$3)',[favUser,s,b]);
await db.query('select line_save_favorite($1,$2,$3)',[favUser,...all[0]]);passed++;
await assert.rejects(db.query('select line_save_favorite($1,$2,$3)',[favUser,...all[10]]),/Favorite limit/);passed++;
assert.equal((await db.query('select count(*)::int n from line_boss_favorites')).rows[0].n,10);passed++;
console.log(`${passed} database checks passed: migration repeatability, shared timers, idempotency, deduplication, rate limit, stale protection, permissions, favorites.`);
await db.close();
