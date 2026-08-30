import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { buildGoogleAuthUrl } from "@/lib/google";

export async function GET(request: Request) {
  try {
    const state = crypto.randomBytes(24).toString("hex");
    const store = await cookies();
    store.set("job_agent_oauth_state", state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 10 * 60,
    });

    return NextResponse.redirect(buildGoogleAuthUrl(request, state));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start Google sign-in.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
