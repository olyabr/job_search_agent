import { GmailSession } from "@/lib/session";

export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

function requireGoogleCredentials() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth credentials are not configured.");
  }
  return { clientId, clientSecret };
}

export function getGoogleRedirectUri(request: Request) {
  return (
    process.env.GOOGLE_REDIRECT_URI ||
    `${new URL(request.url).origin}/api/auth/google/callback`
  );
}

export function buildGoogleAuthUrl(request: Request, state: string) {
  const { clientId } = requireGoogleCredentials();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getGoogleRedirectUri(request),
    response_type: "code",
    scope: `openid email profile ${GMAIL_READONLY_SCOPE}`,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeGoogleCode(request: Request, code: string) {
  const { clientId, clientSecret } = requireGoogleCredentials();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: getGoogleRedirectUri(request),
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Google token exchange failed (${response.status}).`);
  }

  return (await response.json()) as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
  };
}

export async function getGoogleUserInfo(accessToken: string) {
  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!response.ok) return null;
  return (await response.json()) as { email?: string };
}

export async function ensureFreshGoogleSession(session: GmailSession) {
  if (session.expiresAt > Date.now() + 60_000) {
    return { session, changed: false };
  }

  if (!session.refreshToken) {
    throw new Error("Google session expired. Please reconnect Gmail.");
  }

  const { clientId, clientSecret } = requireGoogleCredentials();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: session.refreshToken,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Could not refresh Google access. Please reconnect Gmail.");
  }

  const token = (await response.json()) as {
    access_token: string;
    expires_in: number;
  };

  return {
    changed: true,
    session: {
      ...session,
      accessToken: token.access_token,
      expiresAt: Date.now() + token.expires_in * 1000,
    },
  };
}
