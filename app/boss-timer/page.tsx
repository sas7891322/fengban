"use client";

import {FormEvent,useEffect,useMemo,useState} from "react";
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

const gameServers=["雪吉拉","菇菇寶貝"] as const;

function localInputNow(){
  const d=new Date();
  const local=new Date(d.getTime()-d.getTimezoneOffset()*60_000);
  return local.toISOString().slice(0,16);
}

function formatDateTime(value:string|number){
  return new Date(value).toLocaleString("zh-TW",{
    year:"numeric",
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

export default function BossTimerPage(){
  const[user,setUser]=useState<User|null>(null);
  const[timers,setTimers]=useState<BossTimer[]>([]);
  const[loading,setLoading]=useState(supabaseConfigured);
  const[error,setError]=useState("");
  const[message,setMessage]=useState("");
  const[saving,setSaving]=useState(false);
  const[now,setNow]=useState(()=>Date.now());
  const[serverFilter,setServerFilter]=useState("all");
  const[search,setSearch]=useState("");

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
    const q=search.trim().toLowerCase();
    const rows=timers.filter(timer=>{
      if(serverFilter!=="all"&&timer.server!==serverFilter)return false;
      if(!q)return true;
      return [timer.boss_name,timer.map_name,timer.server,String(timer.channel),timer.notes]
        .join(" ")
        .toLowerCase()
        .includes(q);
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
  },[timers,serverFilter,search,now]);

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

  async function saveTimer(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    const client=supabase;
    if(!client)return flash("尚未連接 Supabase");
    if(!user)return flash("請先回首頁登入會員");

    const form=event.currentTarget;
    const f=new FormData(form);
    const server=String(f.get("server")||"").trim();
    const bossName=String(f.get("boss_name")||"").trim();
    const mapName=String(f.get("map_name")||"").trim();
    const channel=Number(f.get("channel"));
    const minMinutes=Number(f.get("respawn_min_minutes"));
    const maxMinutes=Number(f.get("respawn_max_minutes"));
    const defeatedLocal=String(f.get("defeated_at")||"");
    const notes=String(f.get("notes")||"").trim();

    if(!server||!bossName||!Number.isInteger(channel)||channel<1||channel>99){
      return flash("請確認伺服器、BOSS 與頻道");
    }
    if(!Number.isFinite(minMinutes)||!Number.isFinite(maxMinutes)||minMinutes<1||maxMinutes<minMinutes){
      return flash("重生時間設定不正確");
    }

    const defeatedAt=new Date(defeatedLocal);
    if(Number.isNaN(defeatedAt.getTime()))return flash("請確認擊殺時間");

    setSaving(true);
    const{data:existing,error:lookupError}=await client
      .from("boss_timers")
      .select("id")
      .eq("server",server)
      .eq("boss_name",bossName)
      .eq("channel",channel)
      .maybeSingle();

    if(lookupError){
      setSaving(false);
      return flash(lookupError.message);
    }

    const payload={
      server,
      boss_name:bossName,
      map_name:mapName,
      channel,
      respawn_min_minutes:minMinutes,
      respawn_max_minutes:maxMinutes,
      defeated_at:defeatedAt.toISOString(),
      notes,
      updated_by:user.id
    };

    const result=existing
      ?await client.from("boss_timers").update(payload).eq("id",existing.id)
      :await client.from("boss_timers").insert({...payload,created_by:user.id});

    setSaving(false);
    if(result.error)return flash(result.error.message);

    form.reset();
    const defeatedInput=form.elements.namedItem("defeated_at") as HTMLInputElement|null;
    if(defeatedInput)defeatedInput.value=localInputNow();
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
        <span className="kicker">MAPLESTORY CLASSIC｜BOSS TIMER</span>
        <h1>經典版王重生計時器</h1>
        <p>打死王後記錄擊殺時間，楓伴會自動算出下一次最早／最晚重生時間；同一伺服器、BOSS、頻道會共用同一筆資料。</p>
      </section>

      <div className="panel" style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:12,textAlign:"center"}}>
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
        <h2>新增／更新計時</h2>
        <p>固定重生請填相同分鐘數；區間重生則填最早與最晚分鐘。</p>
      </div>

      <div className="panel">
        {!user&&
          <div style={{marginBottom:14,padding:12,borderRadius:12,background:"rgba(118,80,160,.08)"}}>
            <b>目前是訪客模式</b>
            <div className="muted" style={{marginTop:4}}>可以查看所有計時；新增與重置需要先回楓伴首頁登入。</div>
          </div>
        }

        <form className="form two" onSubmit={saveTimer}>
          <label>
            伺服器
            <select name="server" defaultValue="菇菇寶貝" required>
              {gameServers.map(server=><option key={server} value={server}>{server}</option>)}
            </select>
          </label>

          <label>
            頻道 CH
            <input name="channel" type="number" min={1} max={99} required placeholder="例如 17"/>
          </label>

          <label>
            BOSS 名稱
            <input name="boss_name" maxLength={80} required placeholder="例如：殭屍菇王"/>
          </label>

          <label>
            地圖（選填）
            <input name="map_name" maxLength={120} placeholder="例如：螞蟻洞／隱藏地圖"/>
          </label>

          <label>
            最早重生（分鐘）
            <input name="respawn_min_minutes" type="number" min={1} max={10080} required placeholder="例如 60"/>
          </label>

          <label>
            最晚重生（分鐘）
            <input name="respawn_max_minutes" type="number" min={1} max={10080} required placeholder="固定重生就填同樣數字"/>
          </label>

          <label className="full">
            擊殺時間
            <input name="defeated_at" type="datetime-local" defaultValue={localInputNow()} required/>
          </label>

          <label className="full">
            備註（選填）
            <input name="notes" maxLength={500} placeholder="例如：剛換頻、有人在蹲、掉落日標等"/>
          </label>

          <div className="full" style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
            <button className="btn green" disabled={saving||!user}>
              {saving?"儲存中…":"＋ 開始／更新計時"}
            </button>
            <span className="muted">同一伺服器＋BOSS＋頻道再次儲存，會更新原本計時。</span>
          </div>
        </form>
      </div>

      <div className="sectionTitle">
        <h2>目前王計時</h2>
        <p>會把已進入重生區間與可能已重生的王排在前面。</p>
      </div>

      <div className="panel" style={{marginBottom:18}}>
        <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
          <input
            value={search}
            onChange={e=>setSearch(e.target.value)}
            placeholder="搜尋 BOSS、地圖、頻道…"
            style={{flex:"1 1 220px"}}
          />
          <select value={serverFilter} onChange={e=>setServerFilter(e.target.value)} style={{width:"auto",minWidth:130}}>
            <option value="all">全部伺服器</option>
            {gameServers.map(server=><option key={server} value={server}>{server}</option>)}
          </select>
          <button className="btn soft" onClick={()=>void loadTimers()}>重新整理</button>
        </div>
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

                {timer.map_name&&<div className="muted" style={{marginTop:6}}>📍 {timer.map_name}</div>}

                <div style={{fontSize:26,fontWeight:900,marginTop:14}}>{mainText}</div>
                <div className="muted" style={{marginTop:8,lineHeight:1.7}}>
                  擊殺：{formatDateTime(timer.defeated_at)}<br/>
                  {fixed
                    ?<>預計重生：{formatDateTime(phase.start)}</>
                    :<>重生區間：{formatDateTime(phase.start)} ～ {formatDateTime(phase.end)}</>
                  }
                </div>

                {timer.notes&&<p className="desc">{timer.notes}</p>}

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
