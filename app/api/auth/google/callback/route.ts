import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { exchangeGoogleCode, getGoogleUserInfo } from "@/lib/google";
import { saveGmailSession } from "@/lib/session";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const store = await cookies();
  const expectedState = store.get("job_agent_oauth_state")?.value;

  if (error) {
    return NextResponse.redirect(`${url.origin}/?gmail=error`);
  }

  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(`${url.origin}/?gmail=invalid_state`);
  }

  try {
    const token = await exchangeGoogleCode(request, code);
    const userInfo = await getGoogleUserInfo(token.access_token);

    await saveGmailSession({
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: Date.now() + token.expires_in * 1000,
      email: userInfo?.email,
    });

    store.delete("job_agent_oauth_state");
    return NextResponse.redirect(`${url.origin}/?gmail=connected`);
  } catch {
    return NextResponse.redirect(`${url.origin}/?gmail=error`);
  }
}
