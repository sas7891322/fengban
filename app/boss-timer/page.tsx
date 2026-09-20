"use client";

import Image from "next/image";
import {useEffect,useMemo,useState} from "react";
import type {User} from "@supabase/supabase-js";
import {supabase,supabaseConfigured} from "@/lib/supabase";

type BossDefinition={
  boss_key:string;
  boss_name:string;
  short_name:string;
  icon:string;
  respawn_min_minutes:number;
  respawn_max_minutes:number;
  source_type:string;
  source_note:string;
  sort_order:number;
  is_active:boolean;
};

type BossTimerState={
  id:string;
  server:string;
  boss_key:string;
  channel:number;
  defeated_at:string;
  event_id:string;
  updated_at:string;
};

type BossKillEvent={
  id:string;
  server:string;
  boss_key:string;
  channel:number;
  defeated_at:string;
  interval_seconds:number|null;
  created_at:string;
};

type BossKillConfirmation={
  event_id:string;
  user_id:string;
  reported_at:string;
};

type TimerPhase="countdown"|"window"|"ready";

type AdminBossStat={
  boss:BossDefinition;
  events:number;
  intervals:number[];
  uniquePlayers:number;
  min:number|null;
  p10:number|null;
  median:number|null;
  p90:number|null;
  average:number|null;
  histogram:Array<{label:string;count:number}>;
};

const ACTIVE_SERVER="菇菇寶貝";
const channels=Array.from({length:60},(_,i)=>i+1);

const BOSS_IMAGES:Record<string,string>={
  mano:"/bosses/mano.png",
  stumpy:"/bosses/stumpy.png",
  zombie_lupin_boss:"/bosses/zombie-lupin-boss.png",
  king_clang:"/bosses/king-clang.png",
  mushmom:"/bosses/mushmom.png",
  dyle:"/bosses/dyle.png",
  zombie_mushmom:"/bosses/zombie-mushmom.png",
  jr_balrog:"/bosses/jr-balrog.png"
};

function BossImage({boss,size=92}:{boss:BossDefinition;size?:number}){
  const src=BOSS_IMAGES[boss.boss_key];
  if(!src)return <div style={{fontSize:30}}>{boss.icon}</div>;
  return <div style={{height:size,display:"grid",placeItems:"center"}}>
    <Image
      src={src}
      alt={boss.boss_name}
      width={size}
      height={size}
      sizes={`${size}px`}
      style={{width:"100%",height:"100%",objectFit:"contain"}}
    />
  </div>;
}

// 前端保底王清單：就算 Supabase 尚未建立 boss_definitions，畫面仍會顯示王。
const DEFAULT_BOSSES:BossDefinition[]=[
  {boss_key:"mano",boss_name:"紅寶王",short_name:"紅寶王",icon:"🔴",respawn_min_minutes:30,respawn_max_minutes:45,source_type:"community",source_note:"現版本仍需更多實測",sort_order:10,is_active:true},
  {boss_key:"stumpy",boss_name:"樹妖王",short_name:"樹妖王",icon:"🌳",respawn_min_minutes:35,respawn_max_minutes:45,source_type:"community",source_note:"目前參考 35～45 分",sort_order:20,is_active:true},
  {boss_key:"zombie_lupin_boss",boss_name:"殭屍猴王",short_name:"猴王",icon:"🐒",respawn_min_minutes:45,respawn_max_minutes:45,source_type:"community",source_note:"目前參考 45 分",sort_order:30,is_active:true},
  {boss_key:"king_clang",boss_name:"巨居蟹",short_name:"巨居蟹",icon:"🦀",respawn_min_minutes:45,respawn_max_minutes:45,source_type:"community",source_note:"目前參考 45 分",sort_order:40,is_active:true},
  {boss_key:"mushmom",boss_name:"蘑菇王",short_name:"蘑菇王",icon:"🍄",respawn_min_minutes:45,respawn_max_minutes:60,source_type:"community",source_note:"目前參考 45～60 分",sort_order:50,is_active:true},
  {boss_key:"dyle",boss_name:"沼澤巨鱷",short_name:"巨鱷",icon:"🐊",respawn_min_minutes:45,respawn_max_minutes:45,source_type:"community",source_note:"目前參考 45 分",sort_order:60,is_active:true},
  {boss_key:"zombie_mushmom",boss_name:"殭屍蘑菇王",short_name:"殭屍菇王",icon:"☠️",respawn_min_minutes:45,respawn_max_minutes:55,source_type:"fengban",source_note:"楓伴實測約 45～55 分",sort_order:70,is_active:true},
  {boss_key:"jr_balrog",boss_name:"巴洛古",short_name:"巴洛古",icon:"👹",respawn_min_minutes:405,respawn_max_minutes:540,source_type:"community",source_note:"暫用社群參考值，待實測校正",sort_order:80,is_active:true}
];

function minutesLabel(min:number,max:number){
  const pretty=(value:number)=>{
    if(value<60)return `${value} 分`;
    const h=Math.floor(value/60);
    const m=value%60;
    return m?`${h} 小時 ${m} 分`:`${h} 小時`;
  };
  return min===max?pretty(min):`${pretty(min)}～${pretty(max)}`;
}

function formatDateTime(value:string|number){
  return new Date(value).toLocaleString("zh-TW",{
    month:"2-digit",
    day:"2-digit",
    hour:"2-digit",
    minute:"2-digit",
    second:"2-digit",
    hour12:false
  });
}

function countdown(ms:number){
  const total=Math.max(0,Math.floor(ms/1000));
  const hours=Math.floor(total/3600);
  const minutes=Math.floor((total%3600)/60);
  const seconds=total%60;
  return `${String(hours).padStart(2,"0")}:${String(minutes).padStart(2,"0")}:${String(seconds).padStart(2,"0")}`;
}

function phaseOf(timer:BossTimerState,boss:BossDefinition,now:number){
  const killed=new Date(timer.defeated_at).getTime();
  const start=killed+boss.respawn_min_minutes*60_000;
  const end=killed+boss.respawn_max_minutes*60_000;
  const phase:TimerPhase=now<start?"countdown":now<=end&&end>start?"window":"ready";
  return {phase,start,end};
}

function quantile(sorted:number[],q:number){
  if(sorted.length===0)return null;
  if(sorted.length===1)return sorted[0];
  const pos=(sorted.length-1)*q;
  const base=Math.floor(pos);
  const rest=pos-base;
  const next=sorted[base+1];
  return next===undefined?sorted[base]:sorted[base]+rest*(next-sorted[base]);
}

function roundedMinute(seconds:number|null){
  if(seconds===null)return null;
  return Math.round(seconds/60);
}

function validIntervalsForBoss(events:BossKillEvent[],boss:BossDefinition){
  const minSeconds=15*60;
  const maxMinutes=Math.max(180,Math.ceil(boss.respawn_max_minutes*1.75));
  const maxSeconds=maxMinutes*60;
  return events
    .filter(event=>event.boss_key===boss.boss_key&&event.interval_seconds!==null)
    .map(event=>Number(event.interval_seconds))
    .filter(value=>Number.isFinite(value)&&value>=minSeconds&&value<=maxSeconds)
    .sort((a,b)=>a-b);
}

function histogram5m(intervals:number[]){
  if(intervals.length===0)return [];
  const mins=intervals.map(seconds=>seconds/60);
  const floor=Math.floor(Math.min(...mins)/5)*5;
  const ceil=Math.ceil(Math.max(...mins)/5)*5;
  const rows:Array<{label:string;count:number}>=[];
  for(let start=floor;start<ceil;start+=5){
    const end=start+5;
    const count=mins.filter(value=>value>=start&&(value<end||(end===ceil&&value<=end))).length;
    if(count>0)rows.push({label:`${start}～${end} 分`,count});
  }
  return rows;
}

function ChoiceButton({active,children,onClick,disabled=false}:{active:boolean;children:React.ReactNode;onClick:()=>void;disabled?:boolean}){
  return <button
    type="button"
    disabled={disabled}
    onClick={onClick}
    style={{
      border:active?"2px solid #6d8f3f":"1px solid #e4d9c8",
      background:active?"#eef5e4":"#fffdf9",
      color:"#38271c",
      borderRadius:14,
      padding:"11px 10px",
      fontWeight:900,
      minHeight:44,
      opacity:disabled?.55:1,
      boxShadow:active?"0 5px 16px rgba(109,143,63,.16)":"none"
    }}
  >{children}</button>;
}

export default function BossTimerPage(){
  const[user,setUser]=useState<User|null>(null);
  const[isAdmin,setIsAdmin]=useState(false);
  const[bosses,setBosses]=useState<BossDefinition[]>(DEFAULT_BOSSES);
  const[timers,setTimers]=useState<BossTimerState[]>([]);
  const[selectedBossKey,setSelectedBossKey]=useState(DEFAULT_BOSSES[0]?.boss_key??"");
  const[selectedChannel,setSelectedChannel]=useState<number|null>(null);
  const[loading,setLoading]=useState(supabaseConfigured);
  const[saving,setSaving]=useState(false);
  const[message,setMessage]=useState("");
  const[error,setError]=useState("");
  const[now,setNow]=useState(()=>Date.now());
  const[showAdmin,setShowAdmin]=useState(false);
  const[adminLoading,setAdminLoading]=useState(false);
  const[adminEvents,setAdminEvents]=useState<BossKillEvent[]>([]);
  const[adminConfirmations,setAdminConfirmations]=useState<BossKillConfirmation[]>([]);

  const flash=(text:string)=>{
    setMessage(text);
    window.setTimeout(()=>setMessage(""),2400);
  };

  const selectedBoss=useMemo(
    ()=>bosses.find(boss=>boss.boss_key===selectedBossKey)??null,
    [bosses,selectedBossKey]
  );

  const bossMap=useMemo(
    ()=>Object.fromEntries(bosses.map(boss=>[boss.boss_key,boss])) as Record<string,BossDefinition>,
    [bosses]
  );

  async function loadPublicData(){
    const client=supabase;
    if(!client)return;
    setLoading(true);
    const[bossResult,timerResult]=await Promise.all([
      client.from("boss_definitions")
        .select("boss_key,boss_name,short_name,icon,respawn_min_minutes,respawn_max_minutes,source_type,source_note,sort_order,is_active")
        .eq("is_active",true)
        .order("sort_order"),
      client.from("boss_timer_state")
        .select("id,server,boss_key,channel,defeated_at,event_id,updated_at")
        .eq("server",ACTIVE_SERVER)
        .order("updated_at",{ascending:false})
    ]);

    // boss_definitions 尚未建立或尚未 seed 時，用前端內建清單保底。
    const databaseBosses=!bossResult.error&&bossResult.data&&bossResult.data.length>0
      ?bossResult.data as BossDefinition[]
      :DEFAULT_BOSSES;
    setBosses(databaseBosses);
    setSelectedBossKey(current=>current||databaseBosses[0]?.boss_key||"");

    // 計時表若尚未建立，王仍要顯示，只提示資料庫尚未完成。
    if(timerResult.error){
      setTimers([]);
      setError("王清單已載入；倒數資料庫尚未完成設定："+timerResult.error.message);
      setLoading(false);
      return;
    }

    setTimers((timerResult.data??[]) as BossTimerState[]);
    setError(bossResult.error?"王清單目前使用內建資料；完成 Supabase SQL 後會自動改用資料庫設定。":"");
    setLoading(false);
  }

  async function loadAdminStatus(currentUser:User|null){
    const client=supabase;
    if(!client||!currentUser){
      setIsAdmin(false);
      return;
    }
    const{data,error:adminError}=await client
      .from("admin_users")
      .select("user_id")
      .eq("user_id",currentUser.id)
      .maybeSingle();
    setIsAdmin(!adminError&&Boolean(data));
  }

  async function loadAdminData(){
    const client=supabase;
    if(!client||!isAdmin)return;
    setAdminLoading(true);
    const[eventResult,confirmationResult]=await Promise.all([
      client.from("boss_kill_events")
        .select("id,server,boss_key,channel,defeated_at,interval_seconds,created_at")
        .eq("server",ACTIVE_SERVER)
        .order("defeated_at",{ascending:false})
        .limit(3000),
      client.from("boss_kill_confirmations")
        .select("event_id,user_id,reported_at")
        .order("reported_at",{ascending:false})
        .limit(6000)
    ]);

    if(eventResult.error||confirmationResult.error){
      flash(eventResult.error?.message??confirmationResult.error?.message??"統計資料載入失敗");
      setAdminLoading(false);
      return;
    }

    setAdminEvents((eventResult.data??[]) as BossKillEvent[]);
    setAdminConfirmations((confirmationResult.data??[]) as BossKillConfirmation[]);
    setAdminLoading(false);
  }

  useEffect(()=>{
    const client=supabase;
    if(!client)return;

    void client.auth.getUser().then(({data})=>{
      const current=data.user??null;
      setUser(current);
      void loadAdminStatus(current);
    });

    const{data:auth}=client.auth.onAuthStateChange((_event,session)=>{
      const current=session?.user??null;
      setUser(current);
      void loadAdminStatus(current);
    });

    void loadPublicData();

    const realtime=client
      .channel("fengban-boss-timer-state-v3")
      .on("postgres_changes",{event:"*",schema:"public",table:"boss_timer_state"},()=>void loadPublicData())
      .subscribe();

    return()=>{
      auth.subscription.unsubscribe();
      void client.removeChannel(realtime);
    };
  },[]);

  useEffect(()=>{
    const timer=window.setInterval(()=>setNow(Date.now()),1000);
    return()=>window.clearInterval(timer);
  },[]);

  useEffect(()=>{
    if(showAdmin&&isAdmin)void loadAdminData();
  },[showAdmin,isAdmin]);

  const sortedTimers=useMemo(()=>{
    return [...timers].sort((a,b)=>{
      const bossA=bossMap[a.boss_key];
      const bossB=bossMap[b.boss_key];
      if(!bossA||!bossB)return 0;
      const phaseRank=(timer:BossTimerState,boss:BossDefinition)=>{
        const {phase}=phaseOf(timer,boss,now);
        return phase==="window"?0:phase==="ready"?1:2;
      };
      const rank=phaseRank(a,bossA)-phaseRank(b,bossB);
      if(rank!==0)return rank;
      return new Date(b.updated_at).getTime()-new Date(a.updated_at).getTime();
    });
  },[timers,bossMap,now]);

  const adminStats=useMemo<AdminBossStat[]>(()=>{
    if(!isAdmin)return [];
    const eventIdsByBoss=new Map<string,Set<string>>();
    for(const event of adminEvents){
      if(!eventIdsByBoss.has(event.boss_key))eventIdsByBoss.set(event.boss_key,new Set());
      eventIdsByBoss.get(event.boss_key)!.add(event.id);
    }

    return bosses.map(boss=>{
      const bossEvents=adminEvents.filter(event=>event.boss_key===boss.boss_key);
      const intervals=validIntervalsForBoss(bossEvents,boss);
      const relatedEventIds=eventIdsByBoss.get(boss.boss_key)??new Set<string>();
      const uniquePlayers=new Set(
        adminConfirmations
          .filter(row=>relatedEventIds.has(row.event_id))
          .map(row=>row.user_id)
      ).size;
      const average=intervals.length?intervals.reduce((sum,value)=>sum+value,0)/intervals.length:null;
      return {
        boss,
        events:bossEvents.length,
        intervals,
        uniquePlayers,
        min:roundedMinute(intervals[0]??null),
        p10:roundedMinute(quantile(intervals,.10)),
        median:roundedMinute(quantile(intervals,.50)),
        p90:roundedMinute(quantile(intervals,.90)),
        average:roundedMinute(average),
        histogram:histogram5m(intervals)
      };
    });
  },[isAdmin,bosses,adminEvents,adminConfirmations]);

  async function reportDefeated(){
    const client=supabase;
    if(!client)return flash("尚未連接 Supabase");
    if(!user)return flash("請先回楓伴首頁登入");
    if(!selectedBoss)return flash("請先選王");
    if(!selectedChannel)return flash("請先選頻道");

    setSaving(true);
    const{data,error:rpcError}=await client.rpc("record_boss_kill",{
      p_server:ACTIVE_SERVER,
      p_boss_key:selectedBoss.boss_key,
      p_channel:selectedChannel
    });
    setSaving(false);

    if(rpcError)return flash(rpcError.message);

    const row=Array.isArray(data)?data[0]:data;
    await loadPublicData();
    if(showAdmin&&isAdmin)void loadAdminData();

    if(row?.was_duplicate){
      flash(`已合併到 ${selectedBoss.short_name} CH${selectedChannel} 的同一輪擊殺`);
    }else{
      flash(`${selectedBoss.short_name} CH${selectedChannel} 已開始倒數`);
    }
  }

  const activeCount=timers.length;
  const windowCount=timers.filter(timer=>{
    const boss=bossMap[timer.boss_key];
    return boss&&phaseOf(timer,boss,now).phase==="window";
  }).length;

  return <>
    {!supabaseConfigured&&<div className="setup">尚未連接 Supabase，王計時暫時無法使用。</div>}

    <header className="topbar">
      <div className="nav">
        <div className="brand">
          <a className="back" href="/" aria-label="回楓伴首頁" style={{display:"grid",placeItems:"center",textDecoration:"none"}}>‹</a>
          👑 王計時
        </div>
        <div className="navActions">
          {isAdmin&&<button className={showAdmin?"btn green":"btn soft"} onClick={()=>setShowAdmin(value=>!value)}>
            📊 官方統計
          </button>}
          <a className="btn soft" href="/" style={{textDecoration:"none"}}>回首頁</a>
        </div>
      </div>
    </header>

    <main className="wrap">
      <section className="plain">
        <span className="kicker">MAPLESTORY CLASSIC｜COMMUNITY BOSS TIMER</span>
        <h1>選王、選頻道、按擊殺。</h1>
        <p>玩家不需要回報「王已重生」。每次王被打死只按一次，楓伴會自動累積同王同頻道的擊殺間隔，讓官方帳號慢慢看出真正的重生分布。</p>
      </section>

      <div className="panel" style={{marginTop:18,display:"grid",gridTemplateColumns:"repeat(3,minmax(0,1fr))",gap:10,textAlign:"center"}}>
        <div><div className="muted">測試伺服器</div><div style={{fontWeight:950,fontSize:18,marginTop:4}}>{ACTIVE_SERVER}</div></div>
        <div><div className="muted">目前追蹤</div><div style={{fontWeight:950,fontSize:22,marginTop:2}}>{activeCount}</div></div>
        <div><div className="muted">🔥 重生區間</div><div style={{fontWeight:950,fontSize:22,marginTop:2}}>{windowCount}</div></div>
      </div>

      {error&&<div className="panel" style={{marginTop:18}}>
        <b>目前無法載入王計時</b>
        <div className="muted" style={{marginTop:5}}>{error}</div>
        <button className="btn soft" style={{marginTop:10}} onClick={()=>void loadPublicData()}>重新載入</button>
      </div>}

      {!showAdmin&&<>
        <div className="sectionTitle"><h2>開始計時</h2><p>只有三步，全部用點的。</p></div>
        <div className="panel">
          {!user&&<div style={{padding:12,borderRadius:12,background:"rgba(118,80,160,.08)",marginBottom:16}}>
            <b>目前是訪客模式</b>
            <div className="muted" style={{marginTop:4}}>可以看計時；要回報王已消滅，需要先登入楓伴。</div>
          </div>}

          <div style={{fontWeight:950,marginBottom:9}}>1．選王</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(108px,1fr))",gap:8}}>
            {bosses.map(boss=><ChoiceButton
              key={boss.boss_key}
              active={selectedBossKey===boss.boss_key}
              onClick={()=>{
                setSelectedBossKey(boss.boss_key);
                setSelectedChannel(null);
              }}
            >
              <BossImage boss={boss} size={96}/>
              <div style={{marginTop:6,fontSize:15}}>{boss.short_name}</div>
              <div className="muted" style={{marginTop:4}}>{minutesLabel(boss.respawn_min_minutes,boss.respawn_max_minutes)}</div>
            </ChoiceButton>)}
          </div>

          <div style={{fontWeight:950,margin:"20px 0 9px"}}>2．選頻道</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(54px,1fr))",gap:6}}>
            {channels.map(channel=><ChoiceButton
              key={channel}
              active={selectedChannel===channel}
              onClick={()=>setSelectedChannel(channel)}
            >CH{channel}</ChoiceButton>)}
          </div>

          <div style={{marginTop:18,padding:14,border:"1px solid #eadfce",borderRadius:14,background:"#faf7f1"}}>
            <div className="muted">目前選擇</div>
            <div style={{fontWeight:950,fontSize:18,marginTop:4}}>
              {selectedBoss?.boss_name??"尚未選王"}｜{selectedChannel?`CH${selectedChannel}`:"尚未選頻道"}
            </div>
            {selectedBoss&&<div className="muted" style={{marginTop:4}}>
              目前參考重生：{minutesLabel(selectedBoss.respawn_min_minutes,selectedBoss.respawn_max_minutes)}
            </div>}
          </div>

          <button
            type="button"
            className="btn green"
            disabled={saving||!user||!selectedBoss||!selectedChannel}
            onClick={()=>void reportDefeated()}
            style={{width:"100%",marginTop:12,padding:"16px",fontSize:18}}
          >
            {saving?"紀錄中…":"⚔️ 王已消滅，開始倒數"}
          </button>
          <div className="muted" style={{marginTop:9,textAlign:"center"}}>
            同一隻王、同一頻道短時間多人回報會自動合併成同一輪，不會重複計算。
          </div>
        </div>

        <div className="sectionTitle"><h2>目前計時</h2><p>所有玩家共用。</p></div>
        {loading
          ?<div className="panel"><div className="empty">正在載入王計時…</div></div>
          :sortedTimers.length===0
            ?<div className="panel"><div className="empty">目前還沒有任何王擊殺紀錄。</div></div>
            :<div className="grid">
              {sortedTimers.map(timer=>{
                const boss=bossMap[timer.boss_key];
                if(!boss)return null;
                const phase=phaseOf(timer,boss,now);
                const status=phase.phase==="countdown"?"⏳ 倒數中":phase.phase==="window"?"🔥 重生區間":"✅ 可巡頻";
                const main=phase.phase==="countdown"
                  ?`距最早重生 ${countdown(phase.start-now)}`
                  :phase.phase==="window"
                    ?`區間剩餘 ${countdown(phase.end-now)}`
                    :"已超過目前參考區間";

                return <article className="card" key={timer.id}>
                  <div className="cardHead">
                    <div>
                      <span className="muted" style={{fontWeight:900}}>{ACTIVE_SERVER}｜CH{timer.channel}</span>
                      <div style={{display:"flex",alignItems:"center",gap:8,marginTop:4}}>
                        <BossImage boss={boss} size={54}/>
                        <h3 style={{margin:0}}>{boss.boss_name}</h3>
                      </div>
                    </div>
                    <span className="status">{status}</span>
                  </div>
                  <div style={{fontSize:23,fontWeight:950,marginTop:13}}>{main}</div>
                  <div className="muted" style={{marginTop:8,lineHeight:1.7}}>
                    擊殺：{formatDateTime(timer.defeated_at)}<br/>
                    參考：{minutesLabel(boss.respawn_min_minutes,boss.respawn_max_minutes)}<br/>
                    {boss.respawn_min_minutes===boss.respawn_max_minutes
                      ?<>預計：{formatDateTime(phase.start)}</>
                      :<>區間：{formatDateTime(phase.start)} ～ {formatDateTime(phase.end)}</>}
                  </div>
                </article>;
              })}
            </div>}
      </>}

      {showAdmin&&isAdmin&&<>
        <div className="sectionTitle">
          <h2>官方帳號｜王重生實測統計</h2>
          <p>這裡不要求玩家按「王已重生」，只分析連續擊殺紀錄。</p>
        </div>

        <div className="panel" style={{marginBottom:18}}>
          <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"center",flexWrap:"wrap"}}>
            <div>
              <b>目前統計方式</b>
              <div className="muted" style={{marginTop:4,maxWidth:760}}>
                同王＋同頻道的下一次有效擊殺，形成一筆「擊殺間隔」。間隔包含真正重生時間＋玩家找到王／擊殺所花的時間，因此後台同時看最短值、P10、中位數與分布，不直接把平均值當成真正重生時間。
              </div>
            </div>
            <button className="btn soft" onClick={()=>void loadAdminData()}>{adminLoading?"整理中…":"重新整理統計"}</button>
          </div>
        </div>

        {adminLoading
          ?<div className="panel"><div className="empty">正在整理玩家實測資料…</div></div>
          :<div style={{display:"flex",flexDirection:"column",gap:12}}>
            {adminStats.map(stat=>{
              const maxCount=Math.max(1,...stat.histogram.map(row=>row.count));
              return <article className="panel" key={stat.boss.boss_key}>
                <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"flex-start",flexWrap:"wrap"}}>
                  <div>
                    <div style={{display:"flex",alignItems:"center",gap:9}}>
                      <BossImage boss={stat.boss} size={58}/>
                      <div style={{fontSize:21,fontWeight:950}}>{stat.boss.boss_name}</div>
                    </div>
                    <div className="muted" style={{marginTop:3}}>目前參考：{minutesLabel(stat.boss.respawn_min_minutes,stat.boss.respawn_max_minutes)}</div>
                  </div>
                  <span className="status">{stat.intervals.length} 筆有效週期</span>
                </div>

                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(110px,1fr))",gap:8,marginTop:14}}>
                  {[
                    ["擊殺事件",stat.events],
                    ["參與玩家",stat.uniquePlayers],
                    ["最短",stat.min===null?"—":`${stat.min} 分`],
                    ["P10",stat.p10===null?"—":`${stat.p10} 分`],
                    ["中位數",stat.median===null?"—":`${stat.median} 分`],
                    ["P90",stat.p90===null?"—":`${stat.p90} 分`],
                    ["平均",stat.average===null?"—":`${stat.average} 分`]
                  ].map(([label,value])=><div key={String(label)} style={{padding:10,border:"1px solid #eadfce",borderRadius:12,background:"#fbf8f2",textAlign:"center"}}>
                    <div className="muted">{label}</div>
                    <div style={{fontWeight:950,fontSize:17,marginTop:3}}>{value}</div>
                  </div>)}
                </div>

                <div style={{marginTop:14}}>
                  <div className="muted" style={{fontWeight:900,marginBottom:7}}>5 分鐘區間分布</div>
                  {stat.histogram.length===0
                    ?<div className="empty">還沒有足夠的連續擊殺資料。</div>
                    :<div style={{display:"flex",flexDirection:"column",gap:6}}>
                      {stat.histogram.map(row=><div key={row.label} style={{display:"grid",gridTemplateColumns:"90px 1fr 38px",gap:8,alignItems:"center"}}>
                        <div className="muted" style={{fontWeight:800}}>{row.label}</div>
                        <div style={{height:12,borderRadius:999,background:"#f0ebe3",overflow:"hidden"}}>
                          <div style={{height:"100%",width:`${Math.max(4,row.count/maxCount*100)}%`,background:"#6d8f3f",borderRadius:999}}/>
                        </div>
                        <div className="muted" style={{textAlign:"right"}}>{row.count}</div>
                      </div>)}
                    </div>}
                </div>
              </article>;
            })}
          </div>}
      </>}
    </main>

    {message&&<div className="toast">{message}</div>}
  </>;
}
