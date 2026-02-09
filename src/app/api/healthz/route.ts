import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getBuildSha(): string {
  return process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || "dev";
}

export async function GET() {
  return NextResponse.json({ ok: true, time: new Date().toISOString(), buildSha: getBuildSha() });
}

