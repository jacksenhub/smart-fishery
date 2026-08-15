import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "耕海一号智慧渔业巡检平台",
  description: "智慧渔业巡检船监控、数字孪生与 AI 辅助决策平台。",
  icons: {
    icon: "/icon.png",
    apple: "/apple-icon.png",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" data-scroll-behavior="smooth" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
