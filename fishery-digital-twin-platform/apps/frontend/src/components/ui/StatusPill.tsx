import clsx from "clsx";
import type { DeviceStatus } from "@fishery/shared";

const labelMap: Record<DeviceStatus, string> = {
  online: "在线",
  warning: "预警",
  offline: "离线",
};

export function StatusPill({ status }: { status: DeviceStatus }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold",
        status === "online" && "border-sage-500/20 bg-sage-100 text-sage-500",
        status !== "online" && "border-red-500/20 bg-red-50 text-red-600",
      )}
    >
      <i className="h-1.5 w-1.5 rounded-full bg-current shadow-[0_0_12px_currentColor]" />
      {labelMap[status]}
    </span>
  );
}
