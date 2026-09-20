"use client";

import {useEffect,useMemo,useState} from "react";
import type {User} from "@supabase/supabase-js";
import {supabase,supabaseConfigured} from "@/lib/supabase";

type BossTimer={
  id:string;
  server:string;
  boss_name:string;
  map_name:string;
  channel:number;
  respawn_min_minutes:number;
  respawn_max_minutes:number;
  defeated_at:string;
  notes:string;
  created_by:string;
  updated_by:string;
  created_at:string;
  updated_at:string;
};

type TimerPhase={
  key:"countdown"|"window"|"ready";
  label:string;
  start:number;
  end:number;
};

type BossPreset={
  name:string;
  short:string;
  icon:string;
};

type RespawnPreset={
  label:string;
  min:number;
  max:number;
};

const gameServers=["菇菇寶貝","雪吉拉"] as const;

// 目前經典版常見隱藏／野外 BOSS。重生規則不硬寫死，避免版本變動造成誤導。
const bossPresets:BossPreset[]=[
  {name:"紅寶王",short:"紅寶",icon:"🔴"},
  {name:"樹妖王",short:"樹妖",icon:"🌳"},
  {name:"殭屍猴王",short:"猴王",icon:"🐒"},
  {name:"巨居蟹",short:"巨蟹",icon:"🦀"},
  {name:"蘑菇王",short:"蘑菇",icon:"🍄"},
  {name:"沼澤巨鱷",short:"巨鱷",icon:"🐊"},
  {name:"殭屍蘑菇王",short:"殭屍菇王",icon:"☠️"},
  {name:"巴洛古",short:"巴洛古",icon:"👹"}
];

const respawnPresets:RespawnPreset[]=[
  {label:"30 分",min:30,max:30},
  {label:"45 分",min:45,max:45},
  {label:"60 分",min:60,max:60},
  {label:"90 分",min:90,max:90},
  {label:"2 小時",min:120,max:120},
  {label:"3 小時",min:180,max:180},
  {label:"45～90 分",min:45,max:90},
  {label:"3～4 小時",min:180,max:240}
];

const defeatedOffsets=[
  {label:"剛剛",minutes:0},
  {label:"5 分前",minutes:5},
  {label:"10 分前",minutes:10},
  {label:"15 分前",minutes:15},
  {label:"30 分前",minutes:30}
] as const;

const channels=Array.from({length:60},(_,i)=>i+1);

function formatDateTime(value:string|number){
  return new Date(value).toLocaleString("zh-TW",{
    month:"2-digit",
    day:"2-digit",
    hour:"2-digit",
    minute:"2-digit",
    hour12:false
  });
}

function countdown(ms:number){
  const total=Math.max(0,Math.floor(ms/1000));
  const days=Math.floor(total/86400);
  const hours=Math.floor((total%86400)/3600);
  const minutes=Math.floor((total%3600)/60);
  const seconds=total%60;
  const hh=String(hours).padStart(2,"0");
  const mm=String(minutes).padStart(2,"0");
  const ss=String(seconds).padStart(2,"0");
  return days>0?`${days}天 ${hh}:${mm}:${ss}`:`${hh}:${mm}:${ss}`;
}

function phaseOf(timer:BossTimer,now:number):TimerPhase{
  const defeated=new Date(timer.defeated_at).getTime();
  const start=defeated+timer.respawn_min_minutes*60_000;
  const end=defeated+timer.respawn_max_minutes*60_000;

  if(now<start){
    return {
      key:"countdown",
      label:timer.respawn_min_minutes===timer.respawn_max_minutes?"倒數中":"等待重生區間",
      start,
      end
    };
  }

  if(timer.respawn_max_minutes>timer.respawn_min_minutes&&now<=end){
    return {key:"window",label:"已進入重生區間",start,end};
  }

  return {key:"ready",label:"可能已重生",start,end};
}

function ChoiceButton({active,children,onClick,wide=false}:{active:boolean;children:React.ReactNode;onClick:()=>void;wide?:boolean}){
  return <button
    type="button"
    onClick={onClick}
    style={{
      border:active?"2px solid #6d8f3f":"1px solid #e4d9c8",
      background:active?"#eef5e4":"#fffdf9",
      color:"#38271c",
      borderRadius:14,
      padding:wide?"13px 14px":"11px 10px",
      fontWeight:900,
      boxShadow:active?"0 5px 16px rgba(109,143,63,.16)":"none",
      minHeight:44
    }}
  >{children}</button>;
}

export default function BossTimerPage(){
  const[user,setUser]=useState<User|null>(null);
  const[timers,setTimers]=useState<BossTimer[]>([]);
  const[loading,setLoading]=useState(supabaseConfigured);
  const[error,setError]=useState("");
  const[message,setMessage]=useState("");
  const[saving,setSaving]=useState(false);
  const[now,setNow]=useState(()=>Date.now());

  const[selectedBoss,setSelectedBoss]=useState(bossPresets[6].name);
  const[selectedServer,setSelectedServer]=useState<(typeof gameServers)[number]>("菇菇寶貝");
  const[selectedChannel,setSelectedChannel]=useState<number|null>(null);
  const[selectedRespawn,setSelectedRespawn]=useState<RespawnPreset|null>(null);
  const[selectedOffset,setSelectedOffset]=useState(0);

  const[serverFilter,setServerFilter]=useState<"all"|(typeof gameServers)[number]>("all");
  const[phaseFilter,setPhaseFilter]=useState<"all"|TimerPhase["key"]>("all");
  const[bossFilter,setBossFilter]=useState<string>("all");

  const flash=(text:string)=>{
    setMessage(text);
    window.setTimeout(()=>setMessage(""),2200);
  };

  const loadTimers=async()=>{
    const client=supabase;
    if(!client)return;

    setLoading(true);
    const{data,error:loadError}=await client
      .from("boss_timers")
      .select("id,server,boss_name,map_name,channel,respawn_min_minutes,respawn_max_minutes,defeated_at,notes,created_by,updated_by,created_at,updated_at")
      .order("defeated_at",{ascending:false});

    if(loadError){
      const missingTable=loadError.code==="42P01"||loadError.message.toLowerCase().includes("boss_timers");
      setError(missingTable
        ?"BOSS 計時資料表尚未初始化，請先執行 supabase/fengban_v18_boss_timers.sql。"
        :loadError.message
      );
      setLoading(false);
      return;
    }

    setError("");
    setTimers((data??[]) as BossTimer[]);
    setLoading(false);
  };

  useEffect(()=>{
    const client=supabase;
    if(!client)return;

    void client.auth.getUser().then(({data})=>setUser(data.user??null));
    const{data:auth}=client.auth.onAuthStateChange((_event,session)=>setUser(session?.user??null));
    void loadTimers();

    const realtime=client
      .channel("fengban-boss-timers")
      .on("postgres_changes",{event:"*",schema:"public",table:"boss_timers"},()=>void loadTimers())
      .subscribe();

    const poll=window.setInterval(()=>void loadTimers(),30_000);

    return()=>{
      auth.subscription.unsubscribe();
      window.clearInterval(poll);
      void client.removeChannel(realtime);
    };
  },[]);

  useEffect(()=>{
    const tick=window.setInterval(()=>setNow(Date.now()),1000);
    return()=>window.clearInterval(tick);
  },[]);

  const filteredTimers=useMemo(()=>{
    const rows=timers.filter(timer=>{
      const phase=phaseOf(timer,now);
      if(serverFilter!=="all"&&timer.server!==serverFilter)return false;
      if(phaseFilter!=="all"&&phase.key!==phaseFilter)return false;
      if(bossFilter!=="all"&&timer.boss_name!==bossFilter)return false;
      return true;
    });

    return rows.sort((a,b)=>{
      const pa=phaseOf(a,now);
      const pb=phaseOf(b,now);
      const rank=(p:TimerPhase)=>p.key==="window"?0:p.key==="ready"?1:2;
      const r=rank(pa)-rank(pb);
      if(r!==0)return r;
      if(pa.key==="countdown"&&pb.key==="countdown")return pa.start-pb.start;
      return new Date(b.updated_at).getTime()-new Date(a.updated_at).getTime();
    });
  },[timers,serverFilter,phaseFilter,bossFilter,now]);

  const activeWindowCount=useMemo(
    ()=>timers.filter(timer=>phaseOf(timer,now).key==="window").length,
    [timers,now]
  );

  const readyCount=useMemo(
    ()=>timers.filter(timer=>phaseOf(timer,now).key==="ready").length,
    [timers,now]
  );

  const nextTimer=useMemo(()=>{
    return timers
      .map(timer=>({timer,phase:phaseOf(timer,now)}))
      .filter(item=>item.phase.key==="countdown")
      .sort((a,b)=>a.phase.start-b.phase.start)[0]??null;
  },[timers,now]);

  async function startTimer(){
    const client=supabase;
    if(!client)return flash("尚未連接 Supabase");
    if(!user)return flash("請先回首頁登入會員");
    if(!selectedBoss)return flash("請先點選 BOSS");
    if(!selectedChannel)return flash("請先點選頻道");
    if(!selectedRespawn)return flash("請先點選重生規則");

    const defeatedAt=new Date(Date.now()-selectedOffset*60_000);
    setSaving(true);

    const{data:existing,error:lookupError}=await client
      .from("boss_timers")
      .select("id")
      .eq("server",selectedServer)
      .eq("boss_name",selectedBoss)
      .eq("channel",selectedChannel)
      .maybeSingle();

    if(lookupError){
      setSaving(false);
      return flash(lookupError.message);
    }

    const payload={
      server:selectedServer,
      boss_name:selectedBoss,
      map_name:"",
      channel:selectedChannel,
      respawn_min_minutes:selectedRespawn.min,
      respawn_max_minutes:selectedRespawn.max,
      defeated_at:defeatedAt.toISOString(),
      notes:"",
      updated_by:user.id
    };

    const result=existing
      ?await client.from("boss_timers").update(payload).eq("id",existing.id)
      :await client.from("boss_timers").insert({...payload,created_by:user.id});

    setSaving(false);
    if(result.error)return flash(result.error.message);

    await loadTimers();
    flash(existing?"計時已更新":"已開始新的王計時");
  }

  async function markDefeatedNow(timer:BossTimer){
    const client=supabase;
    if(!client)return;
    if(!user)return flash("請先回首頁登入會員");

    const{error:updateError}=await client
      .from("boss_timers")
      .update({defeated_at:new Date().toISOString(),updated_by:user.id})
      .eq("id",timer.id);

    if(updateError)return flash(updateError.message);
    await loadTimers();
    flash(`${timer.boss_name} CH${timer.channel} 已重新開始計時`);
  }

  async function deleteTimer(timer:BossTimer){
    const client=supabase;
    if(!client||!user)return;
    if(timer.created_by!==user.id)return flash("只有建立者能刪除這筆計時");
    if(!window.confirm(`確定刪除 ${timer.boss_name} CH${timer.channel} 的計時嗎？`))return;

    const{error:deleteError}=await client.from("boss_timers").delete().eq("id",timer.id);
    if(deleteError)return flash(deleteError.message);
    await loadTimers();
    flash("計時已刪除");
  }

  return <>
    {!supabaseConfigured&&
      <div className="setup">尚未連接 Supabase，BOSS 計時暫時無法使用。</div>
    }

    <header className="topbar">
      <div className="nav">
        <div className="brand">
          <a className="back" href="/" aria-label="回楓伴首頁" style={{display:"grid",placeItems:"center",textDecoration:"none"}}>‹</a>
          👑 BOSS 王計時
        </div>
        <div className="navActions">
          <a className="btn soft" href="/" style={{textDecoration:"none"}}>回首頁</a>
        </div>
      </div>
    </header>

    <main className="wrap">
      <section className="plain">
        <span className="kicker">MAPLESTORY CLASSIC｜ONE-TAP BOSS TIMER</span>
        <h1>經典版王計時</h1>
        <p>不用打字、不用下拉。點王、點伺服器、點頻道、點擊殺時間，就能開始倒數。</p>
      </section>

      <div className="panel" style={{marginTop:18,display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:12,textAlign:"center"}}>
        <div>
          <div className="muted" style={{fontSize:13}}>目前追蹤</div>
          <div style={{fontSize:24,fontWeight:900,marginTop:3}}>{timers.length}</div>
        </div>
        <div>
          <div className="muted" style={{fontSize:13}}>🔥 重生區間中</div>
          <div style={{fontSize:24,fontWeight:900,marginTop:3}}>{activeWindowCount}</div>
        </div>
        <div>
          <div className="muted" style={{fontSize:13}}>✅ 可能已重生</div>
          <div style={{fontSize:24,fontWeight:900,marginTop:3}}>{readyCount}</div>
        </div>
        <div>
          <div className="muted" style={{fontSize:13}}>下一隻</div>
          <div style={{fontSize:16,fontWeight:900,marginTop:6}}>
            {nextTimer?`${nextTimer.timer.boss_name} CH${nextTimer.timer.channel}`:"—"}
          </div>
        </div>
      </div>

      {error&&
        <div className="panel" style={{marginTop:18}}>
          <b>王計時目前無法載入</b>
          <div className="muted" style={{marginTop:6}}>{error}</div>
          <button className="btn soft" style={{marginTop:10}} onClick={()=>void loadTimers()}>重新載入</button>
        </div>
      }

      <div className="sectionTitle">
        <h2>快速開始計時</h2>
        <p>照 1 → 5 點選即可。</p>
      </div>

      <div className="panel">
        {!user&&
          <div style={{marginBottom:14,padding:12,borderRadius:12,background:"rgba(118,80,160,.08)"}}>
            <b>目前是訪客模式</b>
            <div className="muted" style={{marginTop:4}}>可以查看所有計時；新增與重置需要先回楓伴首頁登入。</div>
          </div>
        }

        <div style={{fontWeight:950,marginBottom:9}}>1．點選 BOSS</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(116px,1fr))",gap:8}}>
          {bossPresets.map(boss=><ChoiceButton
            key={boss.name}
            active={selectedBoss===boss.name}
            onClick={()=>setSelectedBoss(boss.name)}
            wide
          >
            <div style={{fontSize:22}}>{boss.icon}</div>
            <div style={{marginTop:3}}>{boss.short}</div>
          </ChoiceButton>)}
        </div>

        <div style={{fontWeight:950,margin:"20px 0 9px"}}>2．點選伺服器</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:8}}>
          {gameServers.map(server=><ChoiceButton
            key={server}
            active={selectedServer===server}
            onClick={()=>setSelectedServer(server)}
            wide
          >{server}</ChoiceButton>)}
        </div>

        <div style={{fontWeight:950,margin:"20px 0 9px"}}>3．點選頻道</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(52px,1fr))",gap:6}}>
          {channels.map(channel=><ChoiceButton
            key={channel}
            active={selectedChannel===channel}
            onClick={()=>setSelectedChannel(channel)}
          >CH{channel}</ChoiceButton>)}
        </div>

        <div style={{fontWeight:950,margin:"20px 0 9px"}}>4．點選重生規則</div>
        <div className="muted" style={{marginBottom:8}}>目前先由玩家直接點選規則，避免把尚未完全確認的王重生時間寫死。</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(105px,1fr))",gap:8}}>
          {respawnPresets.map(rule=><ChoiceButton
            key={`${rule.min}-${rule.max}`}
            active={selectedRespawn?.min===rule.min&&selectedRespawn?.max===rule.max}
            onClick={()=>setSelectedRespawn(rule)}
          >{rule.label}</ChoiceButton>)}
        </div>

        <div style={{fontWeight:950,margin:"20px 0 9px"}}>5．王什麼時候被打死？</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(92px,1fr))",gap:8}}>
          {defeatedOffsets.map(offset=><ChoiceButton
            key={offset.minutes}
            active={selectedOffset===offset.minutes}
            onClick={()=>setSelectedOffset(offset.minutes)}
          >{offset.label}</ChoiceButton>)}
        </div>

        <div style={{marginTop:18,padding:14,border:"1px solid #eadfce",borderRadius:14,background:"#faf7f1"}}>
          <div className="muted">目前選擇</div>
          <div style={{fontWeight:950,fontSize:18,marginTop:4,lineHeight:1.6}}>
            {selectedBoss}｜{selectedServer}｜{selectedChannel?`CH${selectedChannel}`:"尚未選 CH"}
          </div>
          <div className="muted" style={{marginTop:2}}>
            重生：{selectedRespawn?.label??"尚未選"}｜擊殺：{defeatedOffsets.find(x=>x.minutes===selectedOffset)?.label}
          </div>
        </div>

        <button
          type="button"
          className="btn green"
          disabled={saving||!user||!selectedChannel||!selectedRespawn}
          onClick={()=>void startTimer()}
          style={{width:"100%",marginTop:12,padding:"15px 16px",fontSize:17}}
        >
          {saving?"儲存中…":"👑 開始／更新這隻王的計時"}
        </button>
      </div>

      <div className="sectionTitle">
        <h2>目前王計時</h2>
        <p>篩選也全部改成直接點選。</p>
      </div>

      <div className="panel" style={{marginBottom:18}}>
        <div className="muted" style={{fontWeight:900,marginBottom:7}}>伺服器</div>
        <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
          <ChoiceButton active={serverFilter==="all"} onClick={()=>setServerFilter("all")}>全部</ChoiceButton>
          {gameServers.map(server=><ChoiceButton key={server} active={serverFilter===server} onClick={()=>setServerFilter(server)}>{server}</ChoiceButton>)}
        </div>

        <div className="muted" style={{fontWeight:900,margin:"14px 0 7px"}}>狀態</div>
        <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
          <ChoiceButton active={phaseFilter==="all"} onClick={()=>setPhaseFilter("all")}>全部</ChoiceButton>
          <ChoiceButton active={phaseFilter==="window"} onClick={()=>setPhaseFilter("window")}>🔥 重生區間</ChoiceButton>
          <ChoiceButton active={phaseFilter==="ready"} onClick={()=>setPhaseFilter("ready")}>✅ 可能已出</ChoiceButton>
          <ChoiceButton active={phaseFilter==="countdown"} onClick={()=>setPhaseFilter("countdown")}>⏳ 倒數中</ChoiceButton>
        </div>

        <div className="muted" style={{fontWeight:900,margin:"14px 0 7px"}}>BOSS</div>
        <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
          <ChoiceButton active={bossFilter==="all"} onClick={()=>setBossFilter("all")}>全部</ChoiceButton>
          {bossPresets.map(boss=><ChoiceButton key={boss.name} active={bossFilter===boss.name} onClick={()=>setBossFilter(boss.name)}>{boss.short}</ChoiceButton>)}
        </div>

        <button className="btn soft" style={{marginTop:14}} onClick={()=>void loadTimers()}>重新整理</button>
      </div>

      {loading
        ?<div className="panel"><div className="empty">正在載入王計時…</div></div>
        :filteredTimers.length===0
          ?<div className="panel"><div className="empty">目前沒有符合條件的王計時。</div></div>
          :<div className="grid">
            {filteredTimers.map(timer=>{
              const phase=phaseOf(timer,now);
              const fixed=timer.respawn_min_minutes===timer.respawn_max_minutes;
              const statusText=phase.key==="window"?"🔥 重生區間":phase.key==="ready"?"✅ 可能已重生":"⏳ 倒數中";
              const mainText=phase.key==="countdown"
                ?`剩餘 ${countdown(phase.start-now)}`
                :phase.key==="window"
                  ?`區間剩 ${countdown(phase.end-now)}`
                  :"建議立即巡頻確認";

              return <article className="card" key={timer.id}>
                <div className="cardHead">
                  <div>
                    <span className="muted" style={{fontWeight:900}}>{timer.server}｜CH{timer.channel}</span>
                    <h3>{timer.boss_name}</h3>
                  </div>
                  <span className="status">{statusText}</span>
                </div>

                <div style={{fontSize:26,fontWeight:900,marginTop:14}}>{mainText}</div>
                <div className="muted" style={{marginTop:8,lineHeight:1.7}}>
                  擊殺：{formatDateTime(timer.defeated_at)}<br/>
                  {fixed
                    ?<>預計重生：{formatDateTime(phase.start)}</>
                    :<>重生區間：{formatDateTime(phase.start)} ～ {formatDateTime(phase.end)}</>
                  }
                </div>

                <div className="cardActions" style={{gap:8,flexWrap:"wrap"}}>
                  <button className="btn green" disabled={!user} onClick={()=>void markDefeatedNow(timer)}>
                    ✅ 剛剛擊殺
                  </button>
                  {user?.id===timer.created_by&&
                    <button className="btn danger" onClick={()=>void deleteTimer(timer)}>刪除</button>
                  }
                </div>

                <div className="muted" style={{marginTop:10,fontSize:12}}>
                  最後更新：{formatDateTime(timer.updated_at)}
                </div>
              </article>;
            })}
          </div>
      }
    </main>

    {message&&<div className="toast">{message}</div>}
  </>;
}
