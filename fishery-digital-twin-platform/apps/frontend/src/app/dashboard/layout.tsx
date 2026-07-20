import { PlatformShell } from "@/components/dashboard/PlatformShell";

export default function DashboardLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <PlatformShell>{children}</PlatformShell>;
}

