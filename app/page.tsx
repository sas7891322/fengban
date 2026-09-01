"use client";
// FENGBAN_EMAIL_PASSWORD_AUTH_V1_20260902
import {FormEvent,useEffect,useMemo,useState} from "react";
import type {User} from "@supabase/supabase-js";
import {supabase,supabaseConfigured} from "@/lib/supabase";

type Cat="priest"|"party"|"boss"|"guild"|"partner";
type Screen="home"|"category"|"account"|"mine";
type Character={id:string;user_id:string;name:string;level:number|null;job:string;server:string};
type CharacterBrief={name:string;level:number|null;job:string}|null;
type Listing={
  id:string;user_id:string;character_id:string|null;category:Cat;title:string;
  subtitle:string|null;server:string;status:string;description:string|null;
  tags:string[];created_at:string;character?:CharacterBrief;
  contact?:{contact_type:string;contact_value:string}|null
};

const cats:Record<Cat,{name:string;short:string;desc:string;image:string;accent:string}>={
  priest:{name:"祭師媒合",short:"祭",desc:"找祈禱、補血與輔助，或刊登自己目前可配合狀態。",image:"/priest.jpg",accent:"#e9872d"},
  party:{name:"組隊任務",short:"隊",desc:"超綠、101、女神等組隊任務找隊伍或開募集。",image:"/party.jpg",accent:"#6d8f3f"},
  boss:{name:"BOSS",short:"王",desc:"預約王團、找缺少的職業與成員。",image:"/boss.jpg",accent:"#7650a0"},
  guild:{name:"公會",short:"會",desc:"找適合自己的公會，或建立長期招生資料。",image:"/guild.jpg",accent:"#4b7eb7"},
  partner:{name:"找夥伴",short:"伴",desc:"找長期一起任務、打王、聊天與成長的玩家。",image:"/partner.jpg",accent:"#cf6170"}
};

const order:Cat[]=["priest","party","boss","guild","partner"];
const statusText:Record<string,string>={
  active:"目前有效",
  tonight:"今晚",
  long_term:"長期",
  paused:"暫停"
};
const contactText:Record<Cat,string>={
  priest:"聯絡祭師",
  party:"我想加入",
  boss:"我要報名",
  guild:"申請加入",
  partner:"想認識"
};

const contactTypeText:Record<string,string>={
  game:"遊戲內暱稱",
  discord:"Discord",
  line:"LINE"
};

const demo:Listing[]=order.map((c,i)=>({
  id:"demo"+i,user_id:"demo",character_id:null,category:c,
  title:["小楓","超綠｜缺 1 人","殘暴炎魔｜缺 2 人","晚風旅團","小雨"][i],
  subtitle:["Lv.83 祭師｜現在可配合","Lv.21～30｜現在","今晚 21:30","晚上活躍","Lv.43 僧侶｜晚上玩家"][i],
  server:"伺服器 A",status:"active",
  description:[
    "可配合祈禱與補血，今晚可長時間配合。",
    "現在準備開，新手也可以，預計連打幾場。",
    "目前 4 / 6，缺 1 位祭師與 1 位打手。",
    "休閒為主，新手、回鍋都歡迎，不強制語音。",
    "喜歡解任務、聊天與慢慢玩，希望找長期夥伴。"
  ][i],
  tags:[["祈禱","補血"],["超綠","新手可"],["祭師","打手"],["新手友善","休閒"],["任務","聊天","長期固定"]][i],
  created_at:new Date().toISOString()
}));

export default function Page(){
  const[screen,setScreen]=useState<Screen>("home");
  const[cat,setCat]=useState<Cat>("priest");
  const[user,setUser]=useState<User|null>(null);
  const[listings,setListings]=useState<Listing[]>(demo);
  const[characters,setCharacters]=useState<Character[]>([]);
  const[authOpen,setAuthOpen]=useState(false);
  const[listingOpen,setListingOpen]=useState(false);
  const[charOpen,setCharOpen]=useState(false);
  const[editing,setEditing]=useState<Listing|null>(null);
  const[contactOpen,setContactOpen]=useState<Listing|null>(null);
  const[email,setEmail]=useState("");
  const[password,setPassword]=useState("");
  const[newPassword,setNewPassword]=useState("");
  const[toast,setToast]=useState("");

  useEffect(()=>{
    if(!supabase)return;
    supabase.auth.getUser().then(({data})=>setUser(data.user??null));
    const{data}=supabase.auth.onAuthStateChange((_e,s)=>setUser(s?.user??null));
    void refreshListings();
    return()=>data.subscription.unsubscribe();
  },[]);

  useEffect(()=>{
    if(user)void refreshCharacters();
    else setCharacters([]);
  },[user]);

  const show=(m:string)=>{
    setToast(m);
    setTimeout(()=>setToast(""),1800);
  };

  async function refreshListings(){
    if(!supabase)return;
    const{data,error}=await supabase
      .from("listings")
      .select("*, character:characters(name,level,job), contact:listing_contacts(contact_type,contact_value)")
      .order("created_at",{ascending:false});
    if(error)return show(error.message);
    setListings((data??[]) as Listing[]);
  }

  async function refreshCharacters(){
    if(!supabase||!user)return;
    const{data,error}=await supabase
      .from("characters")
      .select("*")
      .eq("user_id",user.id)
      .order("created_at");
    if(!error)setCharacters((data??[]) as Character[]);
  }

  const requireLogin=(fn:()=>void)=>{
    if(!supabaseConfigured)return show("尚未連接 Supabase");
    if(!user){setAuthOpen(true);return;}
    fn();
  };

  const openNewListing=()=>{
    setEditing(null);
    setListingOpen(true);
  };

  const openEditListing=(x:Listing)=>{
    setEditing(x);
    setCat(x.category);
    setListingOpen(true);
  };

  async function passwordLogin(e:FormEvent){
    e.preventDefault();
    if(!supabase||!email||!password)return show("請輸入 Email 與密碼");
    const{error}=await supabase.auth.signInWithPassword({email,password});
    if(error)return show("登入失敗："+error.message);
    setAuthOpen(false);
    setPassword("");
    show("登入成功");
  }

  async function registerAccount(){
    if(!supabase||!email||!password)return show("請輸入 Email 與密碼");
    if(password.length<6)return show("密碼至少需要 6 個字元");
    const{data,error}=await supabase.auth.signUp({
      email,
      password,
      options:{emailRedirectTo:window.location.origin}
    });
    if(error)return show("註冊失敗："+error.message);
    if(data.session){
      setAuthOpen(false);
      setPassword("");
      show("註冊並登入成功");
    }else{
      show("註冊完成，請到信箱做一次 Email 驗證");
    }
  }

  async function magicLink(){
    if(!supabase||!email)return show("請先輸入 Email");
    const{error}=await supabase.auth.signInWithOtp({
      email,
      options:{emailRedirectTo:window.location.origin}
    });
    if(error)return show(error.message);
    setAuthOpen(false);
    show("一次性登入連結已寄到信箱");
  }

  async function changePassword(e:FormEvent){
    e.preventDefault();
    if(!supabase||!user)return;
    if(newPassword.length<6)return show("密碼至少需要 6 個字元");
    const{error}=await supabase.auth.updateUser({password:newPassword});
    if(error)return show("設定密碼失敗："+error.message);
    setNewPassword("");
    show("密碼已設定，之後可直接用 Email＋密碼登入");
  }

  async function signOut(){
    if(!supabase)return;
    await supabase.auth.signOut();
    setScreen("home");
    show("已登出");
  }

  async function addChar(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    if(!supabase||!user)return;
    const f=new FormData(e.currentTarget);
    const{error}=await supabase.from("characters").insert({
      user_id:user.id,
      name:String(f.get("name")||""),
      level:Number(f.get("level")||0)||null,
      job:String(f.get("job")||""),
      server:String(f.get("server")||"伺服器 A")
    });
    if(error)return show(error.message);
    setCharOpen(false);
    await refreshCharacters();
    show("角色已建立");
  }

  async function delChar(id:string){
    if(!supabase||!user)return;
    const{error}=await supabase.from("characters").delete().eq("id",id);
    if(error)return show(error.message);
    await refreshCharacters();
    show("角色已刪除");
  }

  async function saveListing(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    if(!supabase||!user)return;

    const f=new FormData(e.currentTarget);
    const characterId=String(f.get("character_id")||"")||null;
    const selectedChar=characters.find(c=>c.id===characterId);
    const tags=String(f.get("tags")||"")
      .split(",")
      .map(x=>x.trim())
      .filter(Boolean);

    const contactType=String(f.get("contact_type")||"game");
    const contactValue=String(f.get("contact_value")||"").trim();
    if(!contactValue)return show("請填寫聯絡資料");

    const payload={
      user_id:user.id,
      character_id:characterId,
      category:String(f.get("category")||cat),
      title:String(f.get("title")||"").trim(),
      subtitle:String(f.get("subtitle")||"").trim(),
      server:selectedChar?.server||String(f.get("server")||"伺服器 A"),
      status:String(f.get("status")||"active"),
      description:String(f.get("description")||"").trim(),
      tags
    };

    const wasEditing=Boolean(editing);
    let listingId=editing?.id||"";

    if(editing){
      const{error}=await supabase
        .from("listings")
        .update(payload)
        .eq("id",editing.id)
        .eq("user_id",user.id);
      if(error)return show(error.message);
    }else{
      const{data,error}=await supabase
        .from("listings")
        .insert(payload)
        .select("id")
        .single();
      if(error)return show(error.message);
      listingId=data.id;
    }

    const{error:contactError}=await supabase
      .from("listing_contacts")
      .upsert({
        listing_id:listingId,
        user_id:user.id,
        contact_type:contactType,
        contact_value:contactValue
      },{onConflict:"listing_id"});

    if(contactError)return show("刊登已儲存，但聯絡資料寫入失敗："+contactError.message);

    setListingOpen(false);
    setEditing(null);
    await refreshListings();
    show(wasEditing?"刊登已更新":"刊登已發布");
  }

  async function delListing(id:string){
    if(!supabase||!user)return;
    const{error}=await supabase.from("listings").delete().eq("id",id);
    if(error)return show(error.message);
    await refreshListings();
    show("刊登已刪除");
  }

  const visible=useMemo(()=>listings.filter(x=>x.category===cat),[listings,cat]);
  const mine=useMemo(()=>user?listings.filter(x=>x.user_id===user.id):[],[listings,user]);

  const top=(title:string,back?:()=>void,create?:()=>void)=>
    <header className="topbar">
      <div className="nav">
        <div className="brand">
          {back?<button className="back" onClick={back}>‹</button>:<span className="mark">楓</span>}
          {title}
        </div>
        <div className="navActions">
          <button className="btn soft" onClick={()=>setScreen("account")}>{user?"帳號":"登入"}</button>
          {screen==="home"&&
            <button className="btn soft desktop" onClick={()=>requireLogin(()=>setScreen("mine"))}>我的刊登</button>
          }
          {create&&<button className="btn green" onClick={create}>＋ 刊登</button>}
        </div>
      </div>
    </header>;

  return <>
    {!supabaseConfigured&&
      <div className="setup">尚未連接 Supabase，登入與多人資料目前無法使用。</div>
    }

    {screen==="home"&&<>
      {top("楓伴",undefined,()=>requireLogin(openNewListing))}
      <main className="wrap">
        <section className="hero">
          <div className="heroShade">
            <span className="kicker">MAPLESTORY CLASSIC 玩家媒合</span>
            <h1>找到一起冒險的人。</h1>
            <p>祭師、組隊任務、BOSS、公會、長期夥伴。資料會真正綁定會員帳號並由所有玩家共用。</p>
          </div>
        </section>
        <div className="sectionTitle">
          <h2>你今天想找什麼？</h2>
          <p>五個核心功能。</p>
        </div>
        <div className="features">
          {order.map(k=>
            <button
              key={k}
              className="feature"
              style={{backgroundImage:`url(${cats[k].image})`,borderColor:cats[k].accent}}
              onClick={()=>{setCat(k);setScreen("category");scrollTo(0,0)}}
            >
              <span className="featureShade"/>
              <span className="featureCopy">
                <b style={{color:cats[k].accent}}>{cats[k].name}</b>
                <em>{cats[k].desc}</em>
              </span>
              <span className="arrow" style={{color:cats[k].accent}}>›</span>
            </button>
          )}
        </div>
      </main>
    </>}

    {screen==="category"&&<>
      {top(cats[cat].name,()=>setScreen("home"),()=>requireLogin(openNewListing))}
      <main className="wrap">
        <section
          className="catHero"
          style={{
            borderColor:cats[cat].accent,
            backgroundImage:`linear-gradient(90deg,rgba(255,255,255,.08),rgba(255,253,248,.93) 72%),url(${cats[cat].image})`
          }}
        >
          <div>
            <h1 style={{color:cats[cat].accent}}>{cats[cat].name}</h1>
            <p>{cats[cat].desc}</p>
          </div>
        </section>
        <div className="sectionTitle">
          <h2>目前刊登</h2>
          <p>共 {visible.length} 筆</p>
        </div>
        <Grid items={visible} uid={user?.id} del={delListing} edit={openEditListing} contact={(x)=>{if(!user){setAuthOpen(true);return;}setContactOpen(x)}}/>
      </main>
    </>}

    {screen==="account"&&<>
      {top("會員與角色",()=>setScreen("home"))}
      <main className="wrap">
        <section className="plain">
          <span className="kicker">ACCOUNT & CHARACTERS</span>
          <h1>會員與角色資料</h1>
          <p>使用 Email＋密碼登入，登入狀態會保留在這台裝置；除非主動登出或瀏覽器清除網站資料。</p>
        </section>

        <div className="sectionTitle"><h2>目前帳號</h2></div>
        <div className="panel row">
          {user?<>
            <div>
              <b>{user.email}</b>
              <div className="muted">已登入</div>
            </div>
            <button className="btn soft" onClick={signOut}>登出</button>
          </>:<>
            <div>
              <b>尚未登入</b>
              <div className="muted">登入後才能建立角色與刊登。</div>
            </div>
            <button className="btn green" onClick={()=>setAuthOpen(true)}>登入</button>
          </>}
        </div>

        {user&&<>
          <div className="sectionTitle">
            <h2>登入密碼</h2>
            <p>舊的 Magic Link 帳號可在這裡設定密碼；之後不必每次收驗證信。</p>
          </div>
          <div className="panel">
            <form className="form" onSubmit={changePassword}>
              <label>
                新密碼
                <input
                  type="password"
                  minLength={6}
                  required
                  value={newPassword}
                  onChange={e=>setNewPassword(e.target.value)}
                  placeholder="至少 6 個字元"
                  autoComplete="new-password"
                />
              </label>
              <button className="btn green">設定／更改密碼</button>
            </form>
          </div>
        </>}

        <div className="sectionTitle">
          <h2>我的角色</h2>
          <p>一個帳號可以保存多個角色。</p>
        </div>
        <div className="panel">
          {user?<>
            {characters.length===0&&<div className="empty">還沒有建立角色。</div>}
            <div className="charList">
              {characters.map(c=>
                <div className="char" key={c.id}>
                  <div>
                    <b>{c.name}</b>
                    <div className="muted">Lv.{c.level??"--"} {c.job}｜{c.server}</div>
                  </div>
                  <button className="btn soft" onClick={()=>delChar(c.id)}>刪除</button>
                </div>
              )}
            </div>
            <button className="btn green" onClick={()=>setCharOpen(true)}>＋ 新增角色</button>
          </>:<div className="empty">登入後可建立角色。</div>}
        </div>
      </main>
    </>}

    {screen==="mine"&&<>
      {top("我的刊登",()=>setScreen("home"),openNewListing)}
      <main className="wrap">
        <section className="plain">
          <h1>我的刊登</h1>
          <p>只有目前帳號建立的內容會出現在這裡。</p>
        </section>
        <div className="sectionTitle">
          <h2>目前資料</h2>
          <p>共 {mine.length} 筆</p>
        </div>
        <Grid items={mine} uid={user?.id} del={delListing} edit={openEditListing} contact={(x)=>setContactOpen(x)}/>
      </main>
    </>}

    {authOpen&&
      <Modal close={()=>{setAuthOpen(false);setPassword("")}}>
        <h2>登入楓伴</h2>
        <p className="muted">使用 Email＋密碼登入。成功登入後，這台裝置會保持登入狀態。</p>
        <form className="form" onSubmit={passwordLogin}>
          <label>
            Email
            <input
              type="email"
              required
              value={email}
              onChange={e=>setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
            />
          </label>
          <label>
            密碼
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={e=>setPassword(e.target.value)}
              placeholder="至少 6 個字元"
              autoComplete="current-password"
            />
          </label>
          <div className="modalActions">
            <button type="button" className="btn soft" onClick={()=>{setAuthOpen(false);setPassword("")}}>取消</button>
            <button className="btn green">登入</button>
          </div>
          <button type="button" className="btn soft" onClick={registerAccount}>註冊新帳號</button>
          <div className="muted" style={{textAlign:"center",marginTop:4}}>
            舊帳號還沒設定密碼，或忘記密碼？
          </div>
          <button type="button" className="btn soft" onClick={magicLink}>寄一次性登入連結</button>
        </form>
      </Modal>
    }

    {charOpen&&
      <Modal close={()=>setCharOpen(false)}>
        <h2>新增角色</h2>
        <form className="form two" onSubmit={addChar}>
          <label>角色暱稱<input name="name" required/></label>
          <label>等級<input name="level" type="number" min="1"/></label>
          <label>職業<input name="job" required placeholder="例如：祭師"/></label>
          <label>伺服器<select name="server"><option>伺服器 A</option><option>伺服器 B</option></select></label>
          <div className="modalActions full">
            <button type="button" className="btn soft" onClick={()=>setCharOpen(false)}>取消</button>
            <button className="btn green">儲存角色</button>
          </div>
        </form>
      </Modal>
    }

    {listingOpen&&
      <Modal close={()=>{setListingOpen(false);setEditing(null)}}>
        <h2>{editing?"編輯刊登":"新增刊登"}</h2>
        <p className="muted">{editing?"修改後會直接更新目前的公開資料。":"發布後其他玩家就能看到。"}</p>
        <form key={editing?.id??"new"} className="form two" onSubmit={saveListing}>
          <label>
            分類
            <select name="category" defaultValue={editing?.category??cat}>
              {order.map(k=><option key={k} value={k}>{cats[k].name}</option>)}
            </select>
          </label>
          <label>
            使用角色
            <select name="character_id" defaultValue={editing?.character_id??""}>
              <option value="">不綁定角色</option>
              {characters.map(c=>
                <option key={c.id} value={c.id}>{c.name}｜Lv.{c.level??"--"} {c.job}</option>
              )}
            </select>
          </label>
          <label>標題<input name="title" required defaultValue={editing?.title??""}/></label>
          <label>副標題<input name="subtitle" defaultValue={editing?.subtitle??""}/></label>
          <label>
            伺服器
            <select name="server" defaultValue={editing?.server??"伺服器 A"}>
              <option>伺服器 A</option>
              <option>伺服器 B</option>
            </select>
          </label>
          <label>
            狀態
            <select name="status" defaultValue={editing?.status??"active"}>
              <option value="active">目前有效</option>
              <option value="tonight">今晚</option>
              <option value="long_term">長期</option>
              <option value="paused">暫停</option>
            </select>
          </label>
          <label className="full">說明<textarea name="description" rows={4} defaultValue={editing?.description??""}/></label>
          <label className="full">標籤（逗號分隔）<input name="tags" defaultValue={(editing?.tags??[]).join(",")} placeholder="祈禱,補血,晚上"/></label>
          <label>
            聯絡方式
            <select name="contact_type" defaultValue={editing?.contact?.contact_type??"game"}>
              <option value="game">遊戲內暱稱</option>
              <option value="discord">Discord</option>
              <option value="line">LINE</option>
            </select>
          </label>
          <label>
            聯絡資料
            <input
              name="contact_value"
              required
              defaultValue={editing?.contact?.contact_value??""}
              placeholder="例如：角色名、Discord ID、LINE ID"
            />
          </label>
          <div className="modalActions full">
            <button type="button" className="btn soft" onClick={()=>{setListingOpen(false);setEditing(null)}}>取消</button>
            <button className="btn green">{editing?"儲存修改":"發布刊登"}</button>
          </div>
        </form>
      </Modal>
    }

    {contactOpen&&
      <Modal close={()=>setContactOpen(null)}>
        <h2>{contactText[contactOpen.category]}</h2>
        <p className="muted">聯絡資料僅提供給已登入會員查看。</p>
        <div className="panel" style={{marginTop:14}}>
          <div className="muted">{contactTypeText[contactOpen.contact?.contact_type??""]??"聯絡方式"}</div>
          <div style={{fontSize:20,fontWeight:900,marginTop:6,wordBreak:"break-all"}}>
            {contactOpen.contact?.contact_value||"尚未設定聯絡資料"}
          </div>
        </div>
        <div className="modalActions" style={{marginTop:14}}>
          <button className="btn soft" onClick={()=>setContactOpen(null)}>關閉</button>
          <button
            className="btn green"
            disabled={!contactOpen.contact?.contact_value}
            onClick={async()=>{
              const value=contactOpen.contact?.contact_value;
              if(!value)return;
              try{
                await navigator.clipboard.writeText(value);
                show("已複製聯絡資料");
              }catch{
                show("無法自動複製，請長按文字複製");
              }
            }}
          >
            複製聯絡資料
          </button>
        </div>
      </Modal>
    }

    {toast&&<div className="toast">{toast}</div>}
  </>;
}

function Grid({
  items,uid,del,edit,contact
}:{
  items:Listing[];
  uid?:string;
  del:(id:string)=>void;
  edit:(x:Listing)=>void;
  contact:(x:Listing)=>void
}){
  if(!items.length)return <div className="empty big">目前還沒有刊登。</div>;

  return <div className="grid">
    {items.map(x=>{
      const c=cats[x.category];
      const own=uid===x.user_id;
      const characterLine=x.character
        ?`${x.character.name}｜Lv.${x.character.level??"--"} ${x.character.job}`
        :"";
      const subtitle=[characterLine,x.subtitle,x.server].filter(Boolean).join("｜");

      return <article className="card" key={x.id}>
        <div className="cardHead">
          <div className="profile">
            <span className="avatar" style={{color:c.accent}}>{c.short}</span>
            <div>
              <h3>{x.title}</h3>
              <div className="muted">{subtitle||"未填寫"}</div>
            </div>
          </div>
          <span className="status">{statusText[x.status]??x.status}</span>
        </div>

        <p className="desc">{x.description||"尚未填寫說明"}</p>

        <div className="tags">
          {(x.tags||[]).map(t=><span className="tag" key={t}>{t}</span>)}
        </div>

        <div className="cardActions" style={{gap:8}}>
          {own?<>
            <button className="btn soft" onClick={()=>edit(x)}>編輯</button>
            <button className="btn danger" onClick={()=>del(x.id)}>刪除</button>
          </>:
            <button
              className="btn"
              style={{background:c.accent,color:"#fff"}}
              onClick={()=>contact(x)}
            >
              {contactText[x.category]}
            </button>
          }
        </div>
      </article>;
    })}
  </div>;
}

function Modal({children,close}:{children:React.ReactNode;close:()=>void}){
  return <div
    className="backdrop"
    onMouseDown={e=>{if(e.currentTarget===e.target)close()}}
  >
    <div className="modal">{children}</div>
  </div>;
}
