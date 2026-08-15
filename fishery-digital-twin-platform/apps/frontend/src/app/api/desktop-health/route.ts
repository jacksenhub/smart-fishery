import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    status: "ok",
    service: "fishery-digital-twin-web",
    time: new Date().toISOString(),
  });
}
