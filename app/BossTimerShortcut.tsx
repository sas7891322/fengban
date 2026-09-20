"use client";

import Link from "next/link";
import {usePathname} from "next/navigation";

export default function BossTimerShortcut(){
  const pathname=usePathname();
  if(pathname==="/boss-timer")return null;

  return <Link
    href="/boss-timer"
    aria-label="開啟 BOSS 王計時"
    style={{
      position:"fixed",
      right:16,
      bottom:84,
      zIndex:60,
      display:"inline-flex",
      alignItems:"center",
      gap:6,
      padding:"11px 14px",
      borderRadius:999,
      background:"#7650a0",
      color:"#fff",
      fontWeight:900,
      textDecoration:"none",
      boxShadow:"0 8px 24px rgba(66,41,88,.28)"
    }}
  >
    👑 王計時
  </Link>;
}
