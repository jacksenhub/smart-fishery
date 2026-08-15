import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function IconFrame({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export function HullWireframeIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="m4.2 8.7 7.8-4.3 7.8 4.3-2.1 7.7-5.7 3.2-5.7-3.2-2.1-7.7Z" />
      <path d="m4.2 8.7 7.8 4.4 7.8-4.4M12 4.4v8.7M6.3 16.4l5.7-3.3 5.7 3.3M12 13.1v6.5" />
    </IconFrame>
  );
}

export function SurfaceProbeIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M4 8.4c1.3.8 2.6.8 3.9 0s2.6-.8 3.9 0 2.6.8 3.9 0 2.6-.8 4 0" />
      <path d="M12 4v11.1M9.8 4h4.4M9.7 15.1h4.6l-1.1 3.4h-2.4l-1.1-3.4Z" />
      <path d="M5 20c1.2-.7 2.4-.7 3.6 0s2.4.7 3.6 0 2.4-.7 3.6 0 2.4.7 3.6 0" />
    </IconFrame>
  );
}

export function PropellerIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M3.5 12h6.8" />
      <circle cx="12" cy="12" r="1.6" />
      <path d="M12 10.4c-.8-2.5-.4-4.9 1.2-5.7 1.3-.6 2.3.6 1.7 2.1l-1.8 3.8" />
      <path d="M13.5 12.2c2.5-.5 4.8.1 5.4 1.7.4 1.3-.9 2.1-2.3 1.3l-3.5-1.8" />
      <path d="M10.9 13.2c-1.6 2-3.8 3-5.1 2-1.1-.9-.4-2.3 1.2-2.5l3.7-.7" />
    </IconFrame>
  );
}

export function WaypointPathIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="5.5" cy="18.5" r="1.8" />
      <circle cx="18.5" cy="5.5" r="1.8" />
      <path d="M7.3 18.5h2A2.7 2.7 0 0 0 12 15.8V9.2a3.7 3.7 0 0 1 3.7-3.7h1" />
      <path d="m14.6 8.2 2.1-2.7-2.1-2.7" />
    </IconFrame>
  );
}

export function VesselStatusIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M4 9.2h16l-2.2 8.2a2.8 2.8 0 0 1-2.7 2.1H8.9a2.8 2.8 0 0 1-2.7-2.1L4 9.2Z" />
      <path d="M8.7 9.2V5.8h6.6v3.4" />
      <path d="M6.8 14.3h2.3l1.2-2.3 2.1 4.5 1.5-2.2h3.3" />
    </IconFrame>
  );
}

export function NavigationJournalIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M6 3.5h8l4 4v13H6v-17Z" />
      <path d="M14 3.5v4h4" />
      <circle cx="9" cy="11" r="1.2" />
      <circle cx="15" cy="16.5" r="1.2" />
      <path d="M10.2 11h1.3a2 2 0 0 1 2 2v1.5a2 2 0 0 0 1.5 2" />
    </IconFrame>
  );
}

export function VesselIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M4 13.2h16l-2.2 4.1a3 3 0 0 1-2.7 1.6H8.9a3 3 0 0 1-2.7-1.6L4 13.2Z" />
      <path d="M8 13.2V9.4h7.4l1.8 3.8M11 9.4V6.2h3.2v3.2" />
      <path d="M3.5 20.2c1 .6 2 .6 3 0s2-.6 3 0 2 .6 3 0 2-.6 3 0 2 .6 3 0 2-.6 3 0" />
    </IconFrame>
  );
}

export function WaterIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M12 3.6c3.3 4 5.3 6.7 5.3 9.4a5.3 5.3 0 0 1-10.6 0c0-2.7 2-5.4 5.3-9.4Z" />
      <path d="M4 19.5c1 .6 2 .6 3 0s2-.6 3 0 2 .6 3 0 2-.6 3 0 2 .6 3 0 2-.6 3 0" />
    </IconFrame>
  );
}

export function RudderIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="m7.6 7 9.1 9.5" />
      <path d="M4.7 3.5c1.2-.8 2.8-.5 3.7.6l1.3 1.6-3.5 3-1.7-1.3c-1.2-.9-1.2-2.9.2-3.9Z" />
      <path d="M3.5 18.7c1 .6 2 .6 3 0s2-.6 3 0 2 .6 3 0 2-.6 3 0 2 .6 3 0 2-.6 3 0" />
    </IconFrame>
  );
}

export function RouteIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="6" cy="17.5" r="2.2" />
      <circle cx="18" cy="6.5" r="2.2" />
      <path d="M8.2 17.5h2.1a2.2 2.2 0 0 0 2.2-2.2v-6A2.8 2.8 0 0 1 15.3 6.5h.5" />
      <path d="m15.8 3.8 2.2 2.7-2.2 2.7" />
    </IconFrame>
  );
}

export function HealthIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M20.2 8.5c0 5-8.2 10.2-8.2 10.2S3.8 13.5 3.8 8.5A4.2 4.2 0 0 1 11.2 5.8L12 6.7l.8-.9a4.2 4.2 0 0 1 7.4 2.7Z" />
      <path d="M6.8 11.8h2.3l1.2-2.3 2.1 4.5 1.4-2.2h3.4" />
    </IconFrame>
  );
}

export function JournalIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M5.5 4.5h10.8A2.2 2.2 0 0 1 18.5 6.7v12.8H7.7a2.2 2.2 0 0 1-2.2-2.2V4.5Z" />
      <path d="M5.5 16.5h10.2M9 8h5.5M9 11.2h5.5" />
    </IconFrame>
  );
}

export function TimeIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M12 7.5v5l3.2 1.8" />
    </IconFrame>
  );
}

export function InsightIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M5 18.5V15l4-3.5 3 2 6-7" />
      <path d="M14.8 6.5H18v3.2" />
      <path d="M5 5.5v13h14" />
    </IconFrame>
  );
}

export function DeviceIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <rect x="5" y="5" width="14" height="14" rx="4" />
      <path d="M9 9h6v6H9zM9 2.8v2.1M15 2.8v2.1M9 19.1v2.1M15 19.1v2.1M2.8 9h2.1M19.1 9h2.1M2.8 15h2.1M19.1 15h2.1" />
    </IconFrame>
  );
}
