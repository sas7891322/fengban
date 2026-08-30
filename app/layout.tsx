import type { Metadata } from "next";
import "./globals.css";
export const metadata:Metadata={title:"楓伴｜找到一起冒險的人",description:"楓之谷經典服玩家媒合"};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="zh-Hant"><body>{children}</body></html>}
