import { NextResponse } from "next/server";
import { getGmailSession } from "@/lib/session";

export async function GET() {
  const session = await getGmailSession();
  return NextResponse.json({
    connected: Boolean(session),
    email: session?.email ?? null,
  });
}
