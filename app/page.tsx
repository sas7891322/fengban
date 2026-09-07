"use client";
// FENGBAN_BRAND_ICON_V15_20260907
import {FormEvent,useEffect,useMemo,useState} from "react";
import type {User} from "@supabase/supabase-js";
import {supabase,supabaseConfigured} from "@/lib/supabase";

type Cat="priest"|"party"|"boss"|"guild"|"partner";
type Screen="home"|"category"|"account"|"mine"|"favorites"|"admin";
type Character={id:string;user_id:string;name:string;level:number|null;job:string;server:string};
type CharacterBrief={name:string;level:number|null;job:string}|null;
type ListingDetails=Record<string,string|number|null>;
type AdminReport={
  id:string;
  reporter_id:string;
  listing_id:string;
  reported_user_id:string;
  reason:string;
  details:string|null;
  status:string;
  created_at:string;
  listing?:{
    id:string;
    title:string;
    category:Cat;
    status:string;
    description:string|null;
  }|null;
};
type Listing={
  id:string;user_id:string;character_id:string|null;category:Cat;title:string;
  subtitle:string|null;server:string;status:string;description:string|null;
  tags:string[];created_at:string;expires_at:string|null;details?:ListingDetails|null;
  character?:CharacterBrief;
  contact?:{contact_type:string;contact_value:string}|null
};

const cats:Record<Cat,{name:string;short:string;desc:string;image:string;accent:string}>={
  priest:{name:"祭師媒合",short:"祭",desc:"找祈禱、補血與輔助，或刊登自己目前可配合狀態。",image:"/priest.jpg",accent:"#e9872d"},
  party:{name:"組隊任務",short:"隊",desc:"超綠、101、女神等組隊任務找隊伍或開募集。",image:"/party.jpg",accent:"#6d8f3f"},
  boss:{name:"BOSS",short:"王",desc:"預約王團、找缺少的職業與成員。",image:"/boss.jpg",accent:"#7650a0"},
  guild:{name:"公會",short:"會",desc:"找適合自己的公會，或建立長期招生資料。",image:"/guild.jpg",accent:"#4b7eb7"},
  partner:{name:"找夥伴",short:"伴",desc:"找長期一起任務、打王、聊天與成長的玩家。",image:"/partner.jpg",accent:"#cf6170"}
};

const order:Cat[]=["guild","partner","priest","party","boss"];
const gameServers=["雪吉拉","菇菇寶貝"] as const;
const categoryOpen:Record<Cat,boolean>={
  priest:false,
  party:false,
  boss:false,
  guild:true,
  partner:true
};
const INACTIVITY_LIMIT_MS=24*60*60*1000;
const LAST_ACTIVITY_KEY="fengban_last_activity";
const VISIT_SESSION_KEY="fengban_visit_counted_v1";
const VISITOR_ID_KEY="fengban_visitor_id_v1";
const DEFAULT_EXPIRY_HOURS:Record<Cat,number>={
  priest:12,
  party:12,
  boss:24*7,
  guild:24*30,
  partner:24*30
};
const expiryOptions=[
  {hours:6,label:"6 小時"},
  {hours:12,label:"12 小時"},
  {hours:24,label:"24 小時"},
  {hours:72,label:"3 天"},
  {hours:168,label:"7 天"},
  {hours:720,label:"30 天"}
];

function addHoursIso(hours:number){
  return new Date(Date.now()+hours*60*60*1000).toISOString();
}

function expiredAt(expiresAt:string|null|undefined,now:number){
  return Boolean(expiresAt&&new Date(expiresAt).getTime()<=now);
}

function expiryLabel(expiresAt:string|null|undefined,now:number){
  if(!expiresAt)return "尚未設定期限";
  const time=new Date(expiresAt).getTime();
  if(time<=now)return "已過期";
  const diff=time-now;
  const hours=Math.ceil(diff/(60*60*1000));
  if(hours<24)return `剩約 ${hours} 小時`;
  const days=Math.ceil(hours/24);
  return `剩約 ${days} 天`;
}

function expiringSoon(expiresAt:string|null|undefined,now:number){
  if(!expiresAt)return false;
  const remaining=new Date(expiresAt).getTime()-now;
  return remaining>0&&remaining<=3*60*60*1000;
}

function detailValue(details:ListingDetails|null|undefined,key:string){
  const value=details?.[key];
  if(value===null||value===undefined||value==="")return "";
  return String(value);
}

function friendlyError(message:string){
  const m=message.toLowerCase();

  if(m.includes("invalid login credentials"))return "Email 或密碼不正確";
  if(m.includes("email not confirmed"))return "請先到信箱完成 Email 驗證";
  if(m.includes("user already registered"))return "這個 Email 已經註冊過";
  if(m.includes("rate limit"))return "操作太頻繁，請稍後再試";
  if(m.includes("failed to fetch")||m.includes("network"))return "網路連線異常，請檢查網路後再試";
  if(m.includes("此分類的有效刊登已達上限"))return "這個分類已達 3 筆有效刊登上限";
  if(m.includes("有效刊登已達上限"))return "有效刊登已達上限，請先刪除或暫停其他刊登";
  if(m.includes("請稍候 60 秒"))return "刊登太快了，請稍候 60 秒再新增";

  return message;
}

function detailRows(x:Listing){
  const d=x.details??{};
  const rows:Array<{label:string;value:string}>=[];
  const add=(label:string,key:string)=>{
    const value=detailValue(d,key);
    if(value)rows.push({label,value});
  };

  if(x.category==="priest"){
    add("可配合時段","available_time");
    add("可提供","support_type");
  }else if(x.category==="party"){
    add("任務","task_name");
    const current=detailValue(d,"current_members");
    const target=detailValue(d,"target_members");
    if(current||target)rows.push({label:"人數",value:`${current||"?"} / ${target||"?"}`});
    add("預計開始","start_time");
  }else if(x.category==="boss"){
    add("BOSS","boss_name");
    add("開團時間","start_time");
    const current=detailValue(d,"current_members");
    const target=detailValue(d,"target_members");
    if(current||target)rows.push({label:"人數",value:`${current||"?"} / ${target||"?"}`});
    add("缺少職業","needed_roles");
  }else if(x.category==="guild"){
    add("公會","guild_name");
    add("活躍時段","active_time");
    add("招募條件","requirements");
  }else if(x.category==="partner"){
    add("常玩時段","active_time");
    add("遊玩風格","play_style");
    add("想一起做","activities");
  }

  return rows;
}
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
  server:gameServers[i%gameServers.length],status:"active",
  description:[
    "可配合祈禱與補血，今晚可長時間配合。",
    "現在準備開，新手也可以，預計連打幾場。",
    "目前 4 / 6，缺 1 位祭師與 1 位打手。",
    "休閒為主，新手、回鍋都歡迎，不強制語音。",
    "喜歡解任務、聊天與慢慢玩，希望找長期夥伴。"
  ][i],
  tags:[["祈禱","補血"],["超綠","新手可"],["祭師","打手"],["新手友善","休閒"],["任務","聊天","長期固定"]][i],
  expires_at:addHoursIso(DEFAULT_EXPIRY_HOURS[c]),
  created_at:new Date().toISOString()
}));

export default function Page(){
  const[screen,setScreen]=useState<Screen>("home");
  const[cat,setCat]=useState<Cat>("guild");
  const[user,setUser]=useState<User|null>(null);
  const[listings,setListings]=useState<Listing[]>(supabaseConfigured?[]:demo);
  const[listingsLoading,setListingsLoading]=useState(supabaseConfigured);
  const[listingsError,setListingsError]=useState("");
  const[characters,setCharacters]=useState<Character[]>([]);
  const[favoriteIds,setFavoriteIds]=useState<string[]>([]);
  const[blockedUserIds,setBlockedUserIds]=useState<string[]>([]);
  const[isAdmin,setIsAdmin]=useState(false);
  const[adminReports,setAdminReports]=useState<AdminReport[]>([]);
  const[safetyOpen,setSafetyOpen]=useState<Listing|null>(null);
  const[authOpen,setAuthOpen]=useState(false);
  const[listingOpen,setListingOpen]=useState(false);
  const[charOpen,setCharOpen]=useState(false);
  const[editing,setEditing]=useState<Listing|null>(null);
  const[contactOpen,setContactOpen]=useState<Listing|null>(null);
  const[email,setEmail]=useState("");
  const[password,setPassword]=useState("");
  const[newPassword,setNewPassword]=useState("");
  const[searchText,setSearchText]=useState("");
  const[filterOpen,setFilterOpen]=useState(false);
  const[listingCategory,setListingCategory]=useState<Cat>("guild");
  const[serverFilter,setServerFilter]=useState("all");
  const[statusFilter,setStatusFilter]=useState("all");
  const[tagFilter,setTagFilter]=useState("all");
  const[sortMode,setSortMode]=useState<"newest"|"expiring"|"longest">("newest");
  const[now,setNow]=useState(()=>Date.now());
  const[toast,setToast]=useState("");
  const[totalVisits,setTotalVisits]=useState<number|null>(null);
  const[onlineCount,setOnlineCount]=useState<number|null>(null);

  useEffect(()=>{
    if(!supabase)return;
    supabase.auth.getUser().then(({data})=>setUser(data.user??null));
    const{data}=supabase.auth.onAuthStateChange((_e,s)=>setUser(s?.user??null));
    void refreshListings();
    return()=>data.subscription.unsubscribe();
  },[]);

  useEffect(()=>{
    const client=supabase;
    if(!client)return;

    let active=true;

    const loadVisitCount=async()=>{
      const alreadyCounted=sessionStorage.getItem(VISIT_SESSION_KEY)==="1";
      const rpcName=alreadyCounted
        ?"get_fengban_visit_count"
        :"record_fengban_visit";

      const{data,error}=await client.rpc(rpcName);

      if(!error&&active){
        const value=Number(data??0);
        if(Number.isFinite(value))setTotalVisits(value);
        if(!alreadyCounted)sessionStorage.setItem(VISIT_SESSION_KEY,"1");
      }
    };

    void loadVisitCount();

    let visitorId=localStorage.getItem(VISITOR_ID_KEY);
    if(!visitorId){
      visitorId=typeof crypto!=="undefined"&&"randomUUID" in crypto
        ?crypto.randomUUID()
        :`visitor-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(VISITOR_ID_KEY,visitorId);
    }

    const channel=client.channel("fengban-online",{
      config:{presence:{key:visitorId}}
    });

    const syncOnlineCount=()=>{
      if(!active)return;
      const state=channel.presenceState();
      setOnlineCount(Object.keys(state).length);
    };

    channel
      .on("presence",{event:"sync"},syncOnlineCount)
      .on("presence",{event:"join"},syncOnlineCount)
      .on("presence",{event:"leave"},syncOnlineCount)
      .subscribe(async status=>{
        if(status==="SUBSCRIBED"){
          await channel.track({
            online_at:new Date().toISOString()
          });
          syncOnlineCount();
        }
      });

    return()=>{
      active=false;
      void channel.untrack();
      void client.removeChannel(channel);
    };
  },[]);

  useEffect(()=>{
    if(user){
      void refreshCharacters();
      void refreshFavorites();
      void refreshBlocks();
      void refreshAdminStatus();
    }else{
      setCharacters([]);
      setFavoriteIds([]);
      setBlockedUserIds([]);
      setIsAdmin(false);
      setAdminReports([]);
    }
  },[user]);

  useEffect(()=>{
    setSearchText("");
    setFilterOpen(false);
    setServerFilter("all");
    setStatusFilter("all");
    setTagFilter("all");
    setSortMode("newest");
  },[cat]);

  useEffect(()=>{
    const timer=window.setInterval(()=>setNow(Date.now()),60*1000);
    return()=>window.clearInterval(timer);
  },[]);

  useEffect(()=>{
    const client=supabase;
    if(!client||!user)return;

    let timer:number|undefined;

    const clearTimer=()=>{
      if(timer!==undefined){
        window.clearTimeout(timer);
        timer=undefined;
      }
    };

    const logoutForInactivity=async()=>{
      clearTimer();
      localStorage.removeItem(LAST_ACTIVITY_KEY);
      await client.auth.signOut();
      setScreen("home");
      show("已超過 24 小時未使用，請重新登入");
    };

    const scheduleLogout=(lastActivity:number)=>{
      clearTimer();
      const remaining=INACTIVITY_LIMIT_MS-(Date.now()-lastActivity);
      if(remaining<=0){
        void logoutForInactivity();
        return false;
      }
      timer=window.setTimeout(()=>void logoutForInactivity(),remaining);
      return true;
    };

    const saved=Number(localStorage.getItem(LAST_ACTIVITY_KEY)||0);
    if(saved&&Date.now()-saved>=INACTIVITY_LIMIT_MS){
      void logoutForInactivity();
      return;
    }

    const initialActivity=saved||Date.now();
    localStorage.setItem(LAST_ACTIVITY_KEY,String(initialActivity));
    scheduleLogout(initialActivity);

    let lastWrite=0;
    const markActivity=()=>{
      const now=Date.now();
      if(now-lastWrite<15000)return;
      lastWrite=now;
      localStorage.setItem(LAST_ACTIVITY_KEY,String(now));
      scheduleLogout(now);
    };

    const onVisibilityChange=()=>{
      if(document.visibilityState!=="visible")return;
      const last=Number(localStorage.getItem(LAST_ACTIVITY_KEY)||0);
      if(last&&Date.now()-last>=INACTIVITY_LIMIT_MS){
        void logoutForInactivity();
        return;
      }
      markActivity();
    };

    window.addEventListener("pointerdown",markActivity,{passive:true});
    window.addEventListener("keydown",markActivity);
    window.addEventListener("scroll",markActivity,{passive:true});
    document.addEventListener("visibilitychange",onVisibilityChange);

    return()=>{
      clearTimer();
      window.removeEventListener("pointerdown",markActivity);
      window.removeEventListener("keydown",markActivity);
      window.removeEventListener("scroll",markActivity);
      document.removeEventListener("visibilitychange",onVisibilityChange);
    };
  },[user]);

  const show=(m:string)=>{
    setToast(m);
    setTimeout(()=>setToast(""),1800);
  };

  async function refreshListings(){
    if(!supabase)return;

    setListingsLoading(true);
    setListingsError("");

    const{data,error}=await supabase
      .from("listings")
      .select("*, character:characters(name,level,job), contact:listing_contacts(contact_type,contact_value)")
      .order("created_at",{ascending:false});

    if(error){
      const message=friendlyError(error.message);
      setListingsError(message);
      setListingsLoading(false);
      return show(message);
    }

    setListings((data??[]) as Listing[]);
    setListingsLoading(false);
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

  async function refreshFavorites(){
    if(!supabase||!user)return;
    const{data,error}=await supabase
      .from("listing_favorites")
      .select("listing_id")
      .eq("user_id",user.id)
      .order("created_at",{ascending:false});

    if(error)return show(friendlyError(error.message));
    setFavoriteIds((data??[]).map(row=>String(row.listing_id)));
  }

  async function refreshBlocks(){
    if(!supabase||!user)return;
    const{data,error}=await supabase
      .from("user_blocks")
      .select("blocked_user_id")
      .eq("blocker_id",user.id)
      .order("created_at",{ascending:false});

    if(error)return show(friendlyError(error.message));
    setBlockedUserIds((data??[]).map(row=>String(row.blocked_user_id)));
  }

  async function refreshAdminStatus(){
    if(!supabase||!user)return;
    const{data,error}=await supabase
      .from("admin_users")
      .select("user_id")
      .eq("user_id",user.id)
      .maybeSingle();

    if(error){
      setIsAdmin(false);
      return;
    }

    const active=Boolean(data);
    setIsAdmin(active);
    if(active)void refreshAdminReports();
    else setAdminReports([]);
  }

  async function refreshAdminReports(){
    if(!supabase||!user)return;
    const{data,error}=await supabase
      .from("listing_reports")
      .select("id,reporter_id,listing_id,reported_user_id,reason,details,status,created_at,listing:listings(id,title,category,status,description)")
      .order("created_at",{ascending:false})
      .limit(100);

    if(error)return show(friendlyError(error.message));

    const normalized=(data??[]).map(row=>({
      ...row,
      listing:Array.isArray(row.listing)
        ?(row.listing[0]??null)
        :(row.listing??null)
    }));

    setAdminReports(normalized as unknown as AdminReport[]);
  }

  const requireLogin=(fn:()=>void)=>{
    if(!supabaseConfigured)return show("尚未連接 Supabase");
    if(!user){setAuthOpen(true);return;}
    fn();
  };

  const openNewListing=()=>{
    if(!categoryOpen[cat]){
      show(`${cats[cat].name}目前暫未開放`);
      return;
    }
    setEditing(null);
    setListingCategory(cat);
    setListingOpen(true);
  };

  const openEditListing=(x:Listing)=>{
    setEditing(x);
    setCat(x.category);
    setListingCategory(x.category);
    setListingOpen(true);
  };

  async function passwordLogin(e:FormEvent){
    e.preventDefault();
    if(!supabase||!email||!password)return show("請輸入 Email 與密碼");
    const{error}=await supabase.auth.signInWithPassword({email,password});
    if(error)return show("登入失敗："+friendlyError(error.message));
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
    if(error)return show("註冊失敗："+friendlyError(error.message));
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
    if(error)return show(friendlyError(error.message));
    setAuthOpen(false);
    show("一次性登入連結已寄到信箱");
  }

  async function changePassword(e:FormEvent){
    e.preventDefault();
    if(!supabase||!user)return;
    if(newPassword.length<6)return show("密碼至少需要 6 個字元");
    const{error}=await supabase.auth.updateUser({password:newPassword});
    if(error)return show("設定密碼失敗："+friendlyError(error.message));
    setNewPassword("");
    show("密碼已設定，之後可直接用 Email＋密碼登入");
  }

  async function signOut(){
    if(!supabase)return;
    localStorage.removeItem(LAST_ACTIVITY_KEY);
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
      server:String(f.get("server")||"雪吉拉")
    });
    if(error)return show(friendlyError(error.message));
    setCharOpen(false);
    await refreshCharacters();
    show("角色已建立");
  }

  async function delChar(id:string){
    if(!supabase||!user)return;
    if(!window.confirm("確定要刪除這個角色嗎？"))return;
    const{error}=await supabase.from("characters").delete().eq("id",id);
    if(error)return show(friendlyError(error.message));
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

    const selectedCategory=String(f.get("category")||cat) as Cat;
    if(!categoryOpen[selectedCategory]){
      return show(`${cats[selectedCategory].name}目前暫未開放，請選擇公會或找夥伴`);
    }
    const expiryChoice=String(f.get("expiry_hours")||DEFAULT_EXPIRY_HOURS[selectedCategory]);
    const expiresAt=editing&&expiryChoice==="keep"
      ?editing.expires_at
      :addHoursIso(Number(expiryChoice)||DEFAULT_EXPIRY_HOURS[selectedCategory]);

    const rawDetail=(name:string)=>String(f.get(name)||"").trim();
    const rawNumber=(name:string)=>{
      const value=Number(f.get(name)||0);
      return value>0?value:null;
    };

    let details:ListingDetails={};

    if(selectedCategory==="priest"){
      details={
        available_time:rawDetail("available_time"),
        support_type:rawDetail("support_type")
      };
    }else if(selectedCategory==="party"){
      details={
        task_name:rawDetail("task_name"),
        current_members:rawNumber("current_members"),
        target_members:rawNumber("target_members"),
        start_time:rawDetail("start_time")
      };
    }else if(selectedCategory==="boss"){
      details={
        boss_name:rawDetail("boss_name"),
        start_time:rawDetail("start_time"),
        current_members:rawNumber("current_members"),
        target_members:rawNumber("target_members"),
        needed_roles:rawDetail("needed_roles")
      };
    }else if(selectedCategory==="guild"){
      details={
        guild_name:rawDetail("guild_name"),
        active_time:rawDetail("active_time"),
        requirements:rawDetail("requirements")
      };
    }else if(selectedCategory==="partner"){
      details={
        active_time:rawDetail("active_time"),
        play_style:rawDetail("play_style"),
        activities:rawDetail("activities")
      };
    }

    const payload={
      user_id:user.id,
      character_id:characterId,
      category:selectedCategory,
      title:String(f.get("title")||"").trim(),
      subtitle:String(f.get("subtitle")||"").trim(),
      server:selectedChar?.server||String(f.get("server")||"雪吉拉"),
      status:String(f.get("status")||"active"),
      description:String(f.get("description")||"").trim(),
      tags,
      details,
      expires_at:expiresAt
    };

    const wasEditing=Boolean(editing);
    let listingId=editing?.id||"";

    if(editing){
      const{error}=await supabase
        .from("listings")
        .update(payload)
        .eq("id",editing.id)
        .eq("user_id",user.id);
      if(error)return show(friendlyError(error.message));
    }else{
      const{data,error}=await supabase
        .from("listings")
        .insert(payload)
        .select("id")
        .single();
      if(error)return show(friendlyError(error.message));
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

    if(contactError)return show("刊登已儲存，但聯絡資料寫入失敗："+friendlyError(contactError.message));

    setListingOpen(false);
    setEditing(null);
    await refreshListings();
    show(wasEditing?"刊登已更新":"刊登已發布");
  }

  async function delListing(id:string){
    if(!supabase||!user)return;
    if(!window.confirm("確定要刪除這筆刊登嗎？刪除後無法復原。"))return;
    const{error}=await supabase.from("listings").delete().eq("id",id);
    if(error)return show(friendlyError(error.message));
    await refreshListings();
    show("刊登已刪除");
  }

  async function renewListing(x:Listing){
    if(!supabase||!user||x.user_id!==user.id)return;
    const payload:{expires_at:string;status?:string}={
      expires_at:addHoursIso(DEFAULT_EXPIRY_HOURS[x.category])
    };
    if(x.status==="paused")payload.status="active";

    const{error}=await supabase
      .from("listings")
      .update(payload)
      .eq("id",x.id)
      .eq("user_id",user.id);

    if(error)return show(friendlyError(error.message));
    await refreshListings();

    const hours=DEFAULT_EXPIRY_HOURS[x.category];
    show(`已續刊 ${hours>=24?Math.round(hours/24)+" 天":hours+" 小時"}`);
  }

  async function toggleFavorite(x:Listing){
    if(!supabaseConfigured)return show("尚未連接 Supabase");
    if(!user){
      setAuthOpen(true);
      return;
    }

    const already=favoriteIds.includes(x.id);

    if(already){
      const{error}=await supabase!
        .from("listing_favorites")
        .delete()
        .eq("user_id",user.id)
        .eq("listing_id",x.id);

      if(error)return show(friendlyError(error.message));
      setFavoriteIds(ids=>ids.filter(id=>id!==x.id));
      show("已取消收藏");
      return;
    }

    const{error}=await supabase!
      .from("listing_favorites")
      .insert({
        user_id:user.id,
        listing_id:x.id
      });

    if(error)return show(friendlyError(error.message));
    setFavoriteIds(ids=>[x.id,...ids.filter(id=>id!==x.id)]);
    show("已加入收藏");
  }

  async function blockUser(x:Listing){
    if(!supabaseConfigured)return show("尚未連接 Supabase");
    if(!user){
      setAuthOpen(true);
      return;
    }
    if(x.user_id===user.id)return show("不能封鎖自己");
    if(!window.confirm("封鎖後，這名玩家的刊登將不再出現在你的列表。確定封鎖嗎？"))return;

    const{error}=await supabase!
      .from("user_blocks")
      .insert({
        blocker_id:user.id,
        blocked_user_id:x.user_id
      });

    if(error&&error.code!=="23505")return show(error.message);

    setBlockedUserIds(ids=>ids.includes(x.user_id)?ids:[x.user_id,...ids]);
    setSafetyOpen(null);
    show("已封鎖這名玩家");
  }

  async function unblockUser(blockedUserId:string){
    if(!supabase||!user)return;

    const{error}=await supabase
      .from("user_blocks")
      .delete()
      .eq("blocker_id",user.id)
      .eq("blocked_user_id",blockedUserId);

    if(error)return show(friendlyError(error.message));
    setBlockedUserIds(ids=>ids.filter(id=>id!==blockedUserId));
    show("已解除封鎖");
  }

  async function reportListing(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    if(!supabase||!user||!safetyOpen)return;
    if(safetyOpen.user_id===user.id)return show("不能檢舉自己的刊登");

    const f=new FormData(e.currentTarget);
    const reason=String(f.get("reason")||"other");
    const details=String(f.get("details")||"").trim();

    const{error}=await supabase
      .from("listing_reports")
      .insert({
        reporter_id:user.id,
        listing_id:safetyOpen.id,
        reported_user_id:safetyOpen.user_id,
        reason,
        details:details||null
      });

    if(error){
      if(error.code==="23505"){
        setSafetyOpen(null);
        return show("你已經檢舉過這筆刊登");
      }
      return show(error.message);
    }

    setSafetyOpen(null);
    show("檢舉已送出");
  }

  async function updateReportStatus(reportId:string,status:"reviewed"|"dismissed"|"actioned"){
    if(!supabase||!user||!isAdmin)return;
    const{error}=await supabase
      .from("listing_reports")
      .update({status})
      .eq("id",reportId);

    if(error)return show(friendlyError(error.message));
    await refreshAdminReports();
    show(status==="dismissed"?"已駁回檢舉":status==="actioned"?"已完成處置":"已標記審核");
  }

  async function adminPauseListing(listingId:string,reportId:string){
    if(!supabase||!user||!isAdmin)return;
    const{error}=await supabase
      .from("listings")
      .update({status:"paused"})
      .eq("id",listingId);

    if(error)return show(friendlyError(error.message));

    const{error:reportError}=await supabase
      .from("listing_reports")
      .update({status:"actioned"})
      .eq("id",reportId);

    if(reportError)return show(reportError.message);
    await Promise.all([refreshAdminReports(),refreshListings()]);
    show("刊登已暫停並完成處置");
  }

  const visible=useMemo(
    ()=>listings.filter(x=>
      categoryOpen[x.category]&&
      x.category===cat&&
      !expiredAt(x.expires_at,now)&&
      !blockedUserIds.includes(x.user_id)
    ),
    [listings,cat,now,blockedUserIds]
  );

  const serverOptions=useMemo(
    ()=>Array.from(new Set(visible.map(x=>x.server).filter(Boolean))).sort(),
    [visible]
  );

  const tagOptions=useMemo(
    ()=>Array.from(new Set(visible.flatMap(x=>x.tags??[]).filter(Boolean))).sort(),
    [visible]
  );

  const filteredVisible=useMemo(()=>{
    const q=searchText.trim().toLowerCase();
    const result=visible.filter(x=>{
      if(serverFilter!=="all"&&x.server!==serverFilter)return false;
      if(statusFilter!=="all"&&x.status!==statusFilter)return false;
      if(tagFilter!=="all"&&!(x.tags??[]).includes(tagFilter))return false;

      if(q){
        const haystack=[
          x.title,
          x.subtitle??"",
          x.description??"",
          x.server,
          x.character?.name??"",
          x.character?.job??"",
          ...(x.tags??[]),
          ...Object.values(x.details??{}).map(value=>String(value??""))
        ].join(" ").toLowerCase();

        if(!haystack.includes(q))return false;
      }

      return true;
    });

    return result.sort((a,b)=>{
      if(sortMode==="expiring"){
        const at=a.expires_at?new Date(a.expires_at).getTime():Number.MAX_SAFE_INTEGER;
        const bt=b.expires_at?new Date(b.expires_at).getTime():Number.MAX_SAFE_INTEGER;
        return at-bt;
      }

      if(sortMode==="longest"){
        const at=a.expires_at?new Date(a.expires_at).getTime():0;
        const bt=b.expires_at?new Date(b.expires_at).getTime():0;
        return bt-at;
      }

      return new Date(b.created_at).getTime()-new Date(a.created_at).getTime();
    });
  },[visible,searchText,serverFilter,statusFilter,tagFilter,sortMode]);


  const activeFilterCount=[
    serverFilter!=="all",
    statusFilter!=="all",
    tagFilter!=="all"
  ].filter(Boolean).length;

  const hasAnyFilter=Boolean(
    searchText.trim()||
    serverFilter!=="all"||
    statusFilter!=="all"||
    tagFilter!=="all"
  );

  const clearFilters=()=>{
    setSearchText("");
    setServerFilter("all");
    setStatusFilter("all");
    setTagFilter("all");
  };

  const mine=useMemo(()=>user?listings.filter(x=>x.user_id===user.id):[],[listings,user]);
  const favorites=useMemo(
    ()=>user?listings.filter(x=>
      favoriteIds.includes(x.id)&&
      !blockedUserIds.includes(x.user_id)
    ):[],
    [listings,favoriteIds,blockedUserIds,user]
  );

  const blockedPlayers=useMemo(
    ()=>blockedUserIds.map(id=>{
      const sample=listings.find(x=>x.user_id===id);
      const label=sample?.character?.name||sample?.title||"已封鎖玩家";
      return {id,label};
    }),
    [blockedUserIds,listings]
  );

  const activeHomeListings=useMemo(
    ()=>listings
      .filter(x=>
        categoryOpen[x.category]&&
        !expiredAt(x.expires_at,now)&&
        x.status!=="paused"&&
        !blockedUserIds.includes(x.user_id)
      )
      .sort((a,b)=>new Date(b.created_at).getTime()-new Date(a.created_at).getTime()),
    [listings,now,blockedUserIds]
  );

  const categoryCounts=useMemo(()=>{
    const counts:Record<Cat,number>={priest:0,party:0,boss:0,guild:0,partner:0};
    for(const item of activeHomeListings)counts[item.category]+=1;
    return counts;
  },[activeHomeListings]);

  const latestHomeListings=useMemo(
    ()=>activeHomeListings.slice(0,4),
    [activeHomeListings]
  );

  const top=(title:string,back?:()=>void,create?:()=>void)=>
    <header className="topbar">
      <div className="nav">
        <div className="brand">
          {back
            ?<button className="back" onClick={back}>‹</button>
            :<img
              src="/fengban-icon.png"
              alt="楓伴"
              width={36}
              height={36}
              style={{
                width:36,
                height:36,
                borderRadius:10,
                objectFit:"cover",
                display:"block",
                boxShadow:"0 4px 14px rgba(123,76,31,.14)"
              }}
            />
          }
          {title}
        </div>
        <div className="navActions">
          <button className="btn soft" onClick={()=>setScreen("account")}>{user?"帳號":"登入"}</button>
          {screen==="home"&&<>
            <button className="btn soft desktop" onClick={()=>requireLogin(()=>setScreen("favorites"))}>我的收藏</button>
            <button className="btn soft desktop" onClick={()=>requireLogin(()=>setScreen("mine"))}>我的刊登</button>
          </>}
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
            <span className="kicker">MAPLESTORY CLASSIC 玩家媒合｜PUBLIC BETA</span>
            <h1>找到一起冒險的人。</h1>
            <p>祭師、組隊任務、BOSS、公會、長期夥伴。資料會真正綁定會員帳號並由所有玩家共用。</p>
          </div>
        </section>

        <div
          className="panel"
          style={{
            marginTop:18,
            display:"grid",
            gridTemplateColumns:"repeat(2,minmax(0,1fr))",
            gap:12,
            textAlign:"center"
          }}
        >
          <div>
            <div className="muted" style={{fontSize:13}}>累積瀏覽</div>
            <div style={{fontSize:22,fontWeight:900,marginTop:2}}>
              {totalVisits===null?"—":totalVisits.toLocaleString()}
            </div>
          </div>
          <div>
            <div className="muted" style={{fontSize:13}}>🟢 目前在線</div>
            <div style={{fontSize:22,fontWeight:900,marginTop:2}}>
              {onlineCount===null?"—":onlineCount.toLocaleString()}
            </div>
          </div>
        </div>

        {listingsError&&
          <div className="panel" style={{marginTop:18}}>
            <b>目前無法載入最新刊登</b>
            <div className="muted" style={{marginTop:4}}>{listingsError}</div>
            <button className="btn soft" style={{marginTop:10}} onClick={()=>void refreshListings()}>
              重新載入
            </button>
          </div>
        }

        <div className="panel" style={{marginTop:18}}>
          <b>Public Beta 目前開放</b>
          <div className="muted" style={{marginTop:6}}>
            現階段先集中測試「公會」與「找夥伴」兩個最實用的媒合功能。
            祭師媒合、組隊任務與 BOSS 將依遊戲版本與玩家需求逐步開放。
          </div>
        </div>

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
              onClick={()=>{
                if(!categoryOpen[k]){
                  show(`${cats[k].name}目前暫未開放`);
                  return;
                }
                setCat(k);
                setScreen("category");
                scrollTo(0,0);
              }}
            >
              <span className="featureShade"/>
              <span className="featureCopy">
                <b style={{color:cats[k].accent}}>{cats[k].name}</b>
                <em>{cats[k].desc}</em>
                <small style={{marginTop:6,fontWeight:800}}>
                  {categoryOpen[k]?`目前 ${categoryCounts[k]} 筆有效刊登`:"🔒 目前暫未開放"}
                </small>
              </span>
              <span className="arrow" style={{color:cats[k].accent}}>›</span>
            </button>
          )}
        </div>
        <div className="sectionTitle" style={{marginTop:28}}>
          <h2>現在有人在找</h2>
          <p>最新有效刊登</p>
        </div>

        {listingsLoading
          ?<div className="panel">
            <div className="empty">正在載入最新刊登…</div>
          </div>
          :latestHomeListings.length===0
            ?<div className="panel">
              <div className="empty">目前還沒有有效刊登，來當第一個吧。</div>
              <button className="btn green" style={{marginTop:10}} onClick={()=>requireLogin(openNewListing)}>
                ＋ 建立第一筆刊登
              </button>
            </div>
            :<div className="grid">
            {latestHomeListings.map(item=>
              <button
                key={item.id}
                className="card"
                style={{textAlign:"left",cursor:"pointer"}}
                onClick={()=>{
                  setCat(item.category);
                  setScreen("category");
                  scrollTo(0,0);
                }}
              >
                <div className="cardTop">
                  <div>
                    <span className="eyebrow">{cats[item.category].name}</span>
                    <h3>{item.title}</h3>
                  </div>
                  <span className="status">{statusText[item.status]??item.status}</span>
                </div>
                <div className="muted" style={{marginTop:8}}>
                  {[item.character?.name,item.server,expiryLabel(item.expires_at,now)]
                    .filter(Boolean)
                    .join("｜")}
                </div>
              </button>
            )}
          </div>
        }
      </main>
    </>}

    {screen==="category"&&<>
      {top(
        cats[cat].name,
        ()=>setScreen("home"),
        categoryOpen[cat]?()=>requireLogin(openNewListing):undefined
      )}
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

        {!categoryOpen[cat]&&
          <div className="panel" style={{marginBottom:18,textAlign:"center"}}>
            <div style={{fontSize:28,marginBottom:6}}>🔒</div>
            <b>{cats[cat].name}目前暫未開放</b>
            <div className="muted" style={{marginTop:6}}>
              Public Beta 目前先集中開放「公會」與「找夥伴」。其他分類會依遊戲版本與實際需求逐步開放。
            </div>
          </div>
        }

        {categoryOpen[cat]&&<>
        <div className="sectionTitle">
          <h2>目前刊登</h2>
          <p>顯示 {filteredVisible.length} / {visible.length} 筆</p>
        </div>

        <div className="panel" style={{marginBottom:18}}>
          <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
            <input
              value={searchText}
              onChange={e=>setSearchText(e.target.value)}
              placeholder="搜尋暱稱、職業、標題、標籤…"
              aria-label="搜尋刊登"
              style={{flex:"1 1 220px"}}
            />
            <select
              value={sortMode}
              onChange={e=>setSortMode(e.target.value as "newest"|"expiring"|"longest")}
              aria-label="刊登排序"
              style={{width:"auto",minWidth:120}}
            >
              <option value="newest">最新優先</option>
              <option value="expiring">即將過期</option>
              <option value="longest">剩餘最久</option>
            </select>
            <button
              type="button"
              className="btn soft"
              onClick={()=>setFilterOpen(v=>!v)}
            >
              篩選{activeFilterCount>0?` (${activeFilterCount})`:""}
            </button>
            {hasAnyFilter&&
              <button type="button" className="btn soft" onClick={clearFilters}>
                清除
              </button>
            }
          </div>

          {filterOpen&&
            <div className="form two" style={{marginTop:14}}>
              <label>
                伺服器
                <select value={serverFilter} onChange={e=>setServerFilter(e.target.value)}>
                  <option value="all">全部伺服器</option>
                  {serverOptions.map(server=>
                    <option key={server} value={server}>{server}</option>
                  )}
                </select>
              </label>

              <label>
                狀態
                <select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}>
                  <option value="all">全部狀態</option>
                  <option value="active">目前有效</option>
                  <option value="tonight">今晚</option>
                  <option value="long_term">長期</option>
                  <option value="paused">暫停</option>
                </select>
              </label>

              <label className="full">
                標籤
                <select value={tagFilter} onChange={e=>setTagFilter(e.target.value)}>
                  <option value="all">全部標籤</option>
                  {tagOptions.map(tag=>
                    <option key={tag} value={tag}>{tag}</option>
                  )}
                </select>
              </label>
            </div>
          }
        </div>

        {listingsLoading
          ?<div className="panel"><div className="empty">正在載入刊登…</div></div>
          :listingsError
            ?<div className="panel">
              <b>刊登載入失敗</b>
              <div className="muted" style={{marginTop:4}}>{listingsError}</div>
              <button className="btn soft" style={{marginTop:10}} onClick={()=>void refreshListings()}>重新載入</button>
            </div>
            :filteredVisible.length===0
              ?<div className="panel">
                <div className="empty">
                  {hasAnyFilter?"沒有符合目前搜尋／篩選條件的刊登。":"目前還沒有這個分類的有效刊登。"}
                </div>
                {hasAnyFilter
                  ?<button className="btn soft" style={{marginTop:10}} onClick={clearFilters}>清除搜尋條件</button>
                  :<button className="btn green" style={{marginTop:10}} onClick={()=>requireLogin(openNewListing)}>＋ 建立刊登</button>
                }
              </div>
              :<Grid items={filteredVisible} uid={user?.id} del={delListing} edit={openEditListing} renew={renewListing} contact={(x)=>{if(!user){setAuthOpen(true);return;}setContactOpen(x)}} favoriteIds={favoriteIds} toggleFavorite={toggleFavorite} safety={(x)=>{if(!user){setAuthOpen(true);return;}setSafetyOpen(x)}} now={now}/>
        }
        </>}
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
              <div className="muted">已登入｜連續 24 小時未使用會自動登出</div>
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
            <h2>我的功能</h2>
            <p>快速查看自己的刊登與收藏。</p>
          </div>
          <div className="panel" style={{display:"flex",gap:10,flexWrap:"wrap"}}>
            <button className="btn green" onClick={()=>setScreen("mine")}>我的刊登</button>
            <button className="btn soft" onClick={()=>setScreen("favorites")}>我的收藏（{favorites.length}）</button>
          </div>
        </>}

        {user&&isAdmin&&<>
          <div className="sectionTitle">
            <h2>管理員工具</h2>
            <p>審核會員檢舉與處理違規刊登。</p>
          </div>
          <div className="panel">
            <button className="btn green" onClick={()=>setScreen("admin")}>
              開啟檢舉審核（{adminReports.filter(r=>r.status==="pending").length}）
            </button>
          </div>
        </>}

        {user&&<>
          <div className="sectionTitle">
            <h2>封鎖名單</h2>
            <p>被封鎖玩家的刊登不會再出現在你的媒合列表。</p>
          </div>
          <div className="panel">
            {blockedPlayers.length===0
              ?<div className="empty">目前沒有封鎖任何玩家。</div>
              :<div className="charList">
                {blockedPlayers.map(player=>
                  <div className="char" key={player.id}>
                    <div>
                      <b>{player.label}</b>
                      <div className="muted">已封鎖</div>
                    </div>
                    <button className="btn soft" onClick={()=>unblockUser(player.id)}>解除封鎖</button>
                  </div>
                )}
              </div>
            }
          </div>
        </>}

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
          <p>只有目前帳號建立的內容會出現在這裡；過期刊登可一鍵續刊。</p>
        </section>
        <div className="sectionTitle">
          <h2>目前資料</h2>
          <p>共 {mine.length} 筆</p>
        </div>
        {mine.length===0
          ?<div className="panel">
            <div className="empty">你還沒有任何刊登。</div>
            <button className="btn green" style={{marginTop:10}} onClick={openNewListing}>＋ 建立第一筆刊登</button>
          </div>
          :<Grid items={mine} uid={user?.id} del={delListing} edit={openEditListing} renew={renewListing} contact={(x)=>setContactOpen(x)} favoriteIds={favoriteIds} toggleFavorite={toggleFavorite} safety={(x)=>{if(!user){setAuthOpen(true);return;}setSafetyOpen(x)}} now={now}/>
        }
      </main>
    </>}

    {screen==="favorites"&&<>
      {top("我的收藏",()=>setScreen("home"))}
      <main className="wrap">
        <section className="plain">
          <h1>我的收藏</h1>
          <p>把想之後再聯絡的祭師、隊伍、BOSS、公會或夥伴先存起來。</p>
        </section>
        <div className="sectionTitle">
          <h2>已收藏刊登</h2>
          <p>共 {favorites.length} 筆</p>
        </div>
        {favorites.length===0
          ?<div className="panel">
            <div className="empty">目前還沒有收藏任何刊登。</div>
            <button className="btn soft" style={{marginTop:10}} onClick={()=>setScreen("home")}>
              回首頁找隊友
            </button>
          </div>
          :<Grid
            items={favorites}
            uid={user?.id}
            del={delListing}
            edit={openEditListing}
            renew={renewListing}
            contact={(x)=>{
              if(expiredAt(x.expires_at,now)){
                show("這筆刊登已過期");
                return;
              }
              setContactOpen(x);
            }}
            favoriteIds={favoriteIds}
            toggleFavorite={toggleFavorite}
            safety={(x)=>setSafetyOpen(x)}
            now={now}
          />
        }
      </main>
    </>}

    {screen==="admin"&&<>
      {top("管理員審核",()=>setScreen("account"))}
      <main className="wrap">
        <section className="plain">
          <span className="kicker">MODERATION</span>
          <h1>檢舉審核</h1>
          <p>這裡只會對管理員開放。可查看檢舉原因、駁回、標記已審核，或直接暫停違規刊登。</p>
        </section>

        {!isAdmin
          ?<div className="panel"><div className="empty">你沒有管理員權限。</div></div>
          :<>
            <div className="sectionTitle">
              <h2>待處理</h2>
              <p>{adminReports.filter(r=>r.status==="pending").length} 筆</p>
            </div>

            <div className="grid">
              {adminReports.length===0&&<div className="empty">目前沒有檢舉資料。</div>}
              {adminReports.map(report=>{
                const reasonText:Record<string,string>={
                  spam:"垃圾／重複刊登",
                  harassment:"騷擾／辱罵",
                  scam:"疑似詐騙",
                  inappropriate:"不當內容",
                  other:"其他"
                };
                const statusLabel:Record<string,string>={
                  pending:"待審核",
                  reviewed:"已審核",
                  dismissed:"已駁回",
                  actioned:"已處置"
                };

                return <article className="card" key={report.id}>
                  <div className="cardTop">
                    <div>
                      <span className="eyebrow">{reasonText[report.reason]??report.reason}</span>
                      <h3>{report.listing?.title??"刊登已不存在"}</h3>
                    </div>
                    <span className="status">{statusLabel[report.status]??report.status}</span>
                  </div>

                  <div className="muted" style={{marginTop:8}}>
                    {new Date(report.created_at).toLocaleString("zh-TW")}
                  </div>

                  <p className="desc">{report.details||"沒有補充說明"}</p>

                  <div className="actions">
                    {report.status==="pending"&&<>
                      <button className="btn soft" onClick={()=>updateReportStatus(report.id,"reviewed")}>標記已審核</button>
                      <button className="btn soft" onClick={()=>updateReportStatus(report.id,"dismissed")}>駁回</button>
                      {report.listing&&
                        <button className="btn danger" onClick={()=>adminPauseListing(report.listing!.id,report.id)}>
                          暫停刊登
                        </button>
                      }
                    </>}
                  </div>
                </article>
              })}
            </div>
          </>
        }
      </main>
    </>}

    {safetyOpen&&
      <Modal close={()=>setSafetyOpen(null)}>
        <h2>安全與檢舉</h2>
        <p className="muted">
          你可以檢舉不當刊登，或直接封鎖這名玩家。
        </p>

        <form className="form" onSubmit={reportListing}>
          <label>
            檢舉原因
            <select name="reason" defaultValue="spam">
              <option value="spam">垃圾／重複刊登</option>
              <option value="harassment">騷擾／辱罵</option>
              <option value="scam">疑似詐騙</option>
              <option value="inappropriate">不當內容</option>
              <option value="other">其他</option>
            </select>
          </label>

          <label>
            補充說明
            <textarea
              name="details"
              rows={4}
              maxLength={500}
              placeholder="可選填，最多 500 字"
            />
          </label>

          <div className="modalActions">
            <button
              type="button"
              className="btn danger"
              onClick={()=>blockUser(safetyOpen)}
            >
              封鎖玩家
            </button>
            <button className="btn green">送出檢舉</button>
          </div>
        </form>
      </Modal>
    }

    {authOpen&&
      <Modal close={()=>{setAuthOpen(false);setPassword("")}}>
        <h2>登入楓伴</h2>
        <p className="muted">使用 Email＋密碼登入。登入後會保持登入；若連續 24 小時未使用楓伴，系統會自動登出。</p>
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
          <label>
            伺服器
            <select name="server" required>
              {gameServers.map(server=><option key={server}>{server}</option>)}
            </select>
          </label>
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
        {!editing&&
          <div className="panel" style={{margin:"12px 0"}}>
            <b>刊登規則</b>
            <div className="muted" style={{marginTop:4}}>
              每 60 秒最多新增 1 筆；每個分類同時最多 3 筆有效刊登；全部分類合計最多 10 筆有效刊登。
            </div>
          </div>
        }
        <form key={editing?.id??"new"} className="form two" onSubmit={saveListing}>
          <label>
            分類
            <select
              name="category"
              value={listingCategory}
              onChange={e=>setListingCategory(e.target.value as Cat)}
            >
              {order.map(k=>
                <option key={k} value={k} disabled={!categoryOpen[k]}>
                  {cats[k].name}{categoryOpen[k]?"":"（尚未開放）"}
                </option>
              )}
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
            <select name="server" defaultValue={editing?.server??characters[0]?.server??gameServers[0]}>
              <option>雪吉拉</option>
              <option>菇菇寶貝</option>
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
          <label>
            有效期限
            <select name="expiry_hours" defaultValue={editing?"keep":String(DEFAULT_EXPIRY_HOURS[listingCategory])}>
              {editing&&<option value="keep">保留目前期限</option>}
              {expiryOptions.map(option=>
                <option key={option.hours} value={option.hours}>{option.label}</option>
              )}
            </select>
          </label>
          {listingCategory==="priest"&&<>
            <label>
              可配合時段
              <input
                name="available_time"
                defaultValue={detailValue(editing?.details,"available_time")}
                placeholder="例如：今晚 20:00～00:00"
              />
            </label>
            <label>
              可提供協助
              <select name="support_type" defaultValue={detailValue(editing?.details,"support_type")||"祈禱＋補血"}>
                <option>祈禱＋補血</option>
                <option>祈禱</option>
                <option>補血</option>
                <option>其他輔助</option>
              </select>
            </label>
          </>}

          {listingCategory==="party"&&<>
            <label>
              任務名稱
              <input
                name="task_name"
                defaultValue={detailValue(editing?.details,"task_name")}
                placeholder="例如：超綠、101、女神"
              />
            </label>
            <label>
              預計開始
              <input
                name="start_time"
                defaultValue={detailValue(editing?.details,"start_time")}
                placeholder="例如：現在、21:30"
              />
            </label>
            <label>
              目前人數
              <input
                name="current_members"
                type="number"
                min="1"
                defaultValue={detailValue(editing?.details,"current_members")}
              />
            </label>
            <label>
              目標人數
              <input
                name="target_members"
                type="number"
                min="1"
                defaultValue={detailValue(editing?.details,"target_members")}
              />
            </label>
          </>}

          {listingCategory==="boss"&&<>
            <label>
              BOSS 名稱
              <input
                name="boss_name"
                defaultValue={detailValue(editing?.details,"boss_name")}
                placeholder="例如：殘暴炎魔"
              />
            </label>
            <label>
              開團時間
              <input
                name="start_time"
                defaultValue={detailValue(editing?.details,"start_time")}
                placeholder="例如：今晚 21:30"
              />
            </label>
            <label>
              目前人數
              <input
                name="current_members"
                type="number"
                min="1"
                defaultValue={detailValue(editing?.details,"current_members")}
              />
            </label>
            <label>
              目標人數
              <input
                name="target_members"
                type="number"
                min="1"
                defaultValue={detailValue(editing?.details,"target_members")}
              />
            </label>
            <label className="full">
              缺少職業
              <input
                name="needed_roles"
                defaultValue={detailValue(editing?.details,"needed_roles")}
                placeholder="例如：祭師、龍騎士、遠攻"
              />
            </label>
          </>}

          {listingCategory==="guild"&&<>
            <label>
              公會名稱
              <input
                name="guild_name"
                defaultValue={detailValue(editing?.details,"guild_name")}
              />
            </label>
            <label>
              活躍時段
              <input
                name="active_time"
                defaultValue={detailValue(editing?.details,"active_time")}
                placeholder="例如：平日晚上、週末"
              />
            </label>
            <label className="full">
              招募條件
              <input
                name="requirements"
                defaultValue={detailValue(editing?.details,"requirements")}
                placeholder="例如：新手友善、不強制語音"
              />
            </label>
          </>}

          {listingCategory==="partner"&&<>
            <label>
              常玩時段
              <input
                name="active_time"
                defaultValue={detailValue(editing?.details,"active_time")}
                placeholder="例如：每天 20:00 後"
              />
            </label>
            <label>
              遊玩風格
              <input
                name="play_style"
                defaultValue={detailValue(editing?.details,"play_style")}
                placeholder="例如：休閒、任務、練等"
              />
            </label>
            <label className="full">
              想一起做的內容
              <input
                name="activities"
                defaultValue={detailValue(editing?.details,"activities")}
                placeholder="例如：打王、解任務、聊天、固定練功"
              />
            </label>
          </>}
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

    <nav
      className="mobileBottomNav"
      aria-label="手機導覽"
      style={{
        position:"fixed",
        left:0,
        right:0,
        bottom:0,
        zIndex:30,
        display:"flex",
        justifyContent:"space-around",
        gap:6,
        padding:"8px max(10px, env(safe-area-inset-left)) calc(8px + env(safe-area-inset-bottom)) max(10px, env(safe-area-inset-right))",
        background:"rgba(255,253,248,.96)",
        borderTop:"1px solid #eadfce",
        backdropFilter:"blur(10px)"
      }}
    >
      <button
        className={screen==="home"?"btn green":"btn soft"}
        style={{flex:1,padding:"10px 6px"}}
        onClick={()=>setScreen("home")}
      >
        首頁
      </button>
      <button
        className={screen==="favorites"?"btn green":"btn soft"}
        style={{flex:1,padding:"10px 6px"}}
        onClick={()=>requireLogin(()=>setScreen("favorites"))}
      >
        收藏
      </button>
      <button
        className="btn green"
        style={{flex:1,padding:"10px 6px"}}
        onClick={()=>requireLogin(()=>{
          if(!categoryOpen[cat])setCat("guild");
          setEditing(null);
          setListingCategory(categoryOpen[cat]?cat:"guild");
          setListingOpen(true);
        })}
      >
        ＋ 刊登
      </button>
      <button
        className={screen==="mine"?"btn green":"btn soft"}
        style={{flex:1,padding:"10px 6px"}}
        onClick={()=>requireLogin(()=>setScreen("mine"))}
      >
        我的
      </button>
      <button
        className={screen==="account"?"btn green":"btn soft"}
        style={{flex:1,padding:"10px 6px"}}
        onClick={()=>setScreen("account")}
      >
        帳號
      </button>
    </nav>

    <div className="mobileBottomSpacer" style={{height:82}}/>
    {toast&&<div className="toast">{toast}</div>}
  </>;
}

function Grid({
  items,uid,del,edit,renew,contact,favoriteIds,toggleFavorite,safety,now
}:{
  items:Listing[];
  uid?:string;
  del:(id:string)=>void;
  edit:(x:Listing)=>void;
  renew:(x:Listing)=>void;
  contact:(x:Listing)=>void;
  favoriteIds:string[];
  toggleFavorite:(x:Listing)=>void;
  safety:(x:Listing)=>void;
  now:number
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
      const isExpired=expiredAt(x.expires_at,now);
      const isExpiringSoon=expiringSoon(x.expires_at,now);
      const isFavorite=favoriteIds.includes(x.id);
      const expiry=expiryLabel(x.expires_at,now);

      return <article className="card" key={x.id}>
        <div className="cardHead">
          <div className="profile">
            <span className="avatar" style={{color:c.accent}}>{c.short}</span>
            <div>
              <h3>{x.title}</h3>
              <div className="muted">{subtitle||"未填寫"}</div>
            </div>
          </div>
          <span className="status">{isExpired?"已過期":statusText[x.status]??x.status}</span>
        </div>

        <div className="muted" style={{marginTop:8}}>
          {isExpired
            ?"刊登已過期"
            :isExpiringSoon
              ?`即將過期｜${expiry}`
              :`有效期限：${expiry}`}
        </div>

        {detailRows(x).length>0&&
          <div
            style={{
              marginTop:10,
              padding:"10px 12px",
              border:"1px solid #eadfce",
              borderRadius:12,
              background:"#fffaf2",
              display:"grid",
              gap:6
            }}
          >
            {detailRows(x).map(row=>
              <div
                key={`${row.label}-${row.value}`}
                style={{display:"flex",gap:8,alignItems:"flex-start"}}
              >
                <b style={{minWidth:72,fontSize:13}}>{row.label}</b>
                <span style={{fontSize:13,wordBreak:"break-word"}}>{row.value}</span>
              </div>
            )}
          </div>
        }

        <p className="desc">{x.description||"尚未填寫說明"}</p>

        <div className="tags">
          {(x.tags||[]).map(t=><span className="tag" key={t}>{t}</span>)}
        </div>

        <div className="cardActions" style={{gap:8}}>
          {own?<>
            <button className="btn soft" onClick={()=>edit(x)}>編輯</button>
            <button className="btn green" onClick={()=>renew(x)}>{isExpired?"續刊":"延長"}</button>
            <button className="btn danger" onClick={()=>del(x.id)}>刪除</button>
          </>:<>
            <button
              className="btn soft"
              onClick={()=>toggleFavorite(x)}
              aria-label={isFavorite?"取消收藏":"加入收藏"}
            >
              {isFavorite?"★ 已收藏":"☆ 收藏"}
            </button>
            <button className="btn soft" onClick={()=>safety(x)}>安全</button>
            {isExpired
              ?<button className="btn soft" disabled>已過期</button>
              :<button
                className="btn"
                style={{background:c.accent,color:"#fff"}}
                onClick={()=>contact(x)}
              >
                {contactText[x.category]}
              </button>
            }
          </>}
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
