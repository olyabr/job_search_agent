import { NextResponse } from "next/server";
import { clearGmailSession, getGmailSession } from "@/lib/session";

export async function POST() {
  const session = await getGmailSession();

  if (session?.refreshToken || session?.accessToken) {
    const token = session.refreshToken || session.accessToken;
    try {
      await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }),
        cache: "no-store",
      });
    } catch {
      // Local session is cleared even if Google revocation is temporarily unavailable.
    }
  }

  await clearGmailSession();
  return NextResponse.json({ connected: false });
}
