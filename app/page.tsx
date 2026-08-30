"use client";

import { useEffect, useMemo, useState } from "react";
import {
  rankJobs,
  type CareerProfile,
  type EmailJobInput,
  type JobMatch,
} from "@/lib/job-match";

const GOOGLE_CLIENT_ID = "PASTE_GOOGLE_CLIENT_ID_HERE";
const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const JOB_QUERY = [
  "newer_than:30d",
  "-in:spam",
  "-in:trash",
  "{subject:job subject:jobs subject:opportunity subject:position subject:role subject:hiring",
  "from:jobalert.indeed.com from:linkedin.com from:rigzonemail.com",
  "from:ziprecruiter.com from:glassdoor.com}",
].join(" ");

const defaultProfile: CareerProfile = {
  profileName: "My job search",
  targetRoles: "",
  skills: "",
  preferredLocations: "",
  industryKeywords: "",
  seniorityKeywords: "",
  avoidKeywords: "",
  remoteOkay: true,
  minimumMatch: 60,
};

type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

type GoogleTokenClient = {
  requestAccessToken: (config?: { prompt?: string }) => void;
};

type GoogleOAuthApi = {
  initTokenClient: (config: {
    client_id: string;
    scope: string;
    callback: (response: GoogleTokenResponse) => void;
    error_callback?: (error: { type?: string }) => void;
  }) => GoogleTokenClient;
  hasGrantedAllScopes: (response: GoogleTokenResponse, ...scopes: string[]) => boolean;
  revoke: (token: string, callback?: () => void) => void;
};

type GoogleWindow = Window & {
  google?: {
    accounts?: {
      oauth2?: GoogleOAuthApi;
    };
  };
};

type GmailList = { messages?: Array<{ id: string }> };
type GmailProfile = { emailAddress?: string };
type GmailMessage = {
  id: string;
  snippet?: string;
  internalDate?: string;
  payload?: {
    headers?: Array<{ name: string; value: string }>;
  };
};

function storageKey(email: string) {
  return `job-agent-profile:${email.toLowerCase()}`;
}

function readProfile(key: string, allowLegacy = false) {
  const stored = window.localStorage.getItem(key);
  const legacy = allowLegacy ? window.localStorage.getItem("job-agent-profile") : null;
  const raw = stored || legacy;

  if (!raw) return defaultProfile;

  try {
    const parsed = { ...defaultProfile, ...(JSON.parse(raw) as Partial<CareerProfile>) };
    if (!stored && legacy) {
      window.localStorage.setItem(key, JSON.stringify(parsed));
      window.localStorage.removeItem("job-agent-profile");
    }
    return parsed;
  } catch {
    return defaultProfile;
  }
}

function getGoogleOAuth() {
  return (window as GoogleWindow).google?.accounts?.oauth2;
}

function clientConfigured() {
  return GOOGLE_CLIENT_ID.endsWith(".apps.googleusercontent.com");
}

async function gmailFetch<T>(accessToken: string, path: string) {
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Gmail request failed (${response.status}).`);
  }
  return (await response.json()) as T;
}

function getHeader(message: GmailMessage, name: string) {
  return message.payload?.headers?.find(
    (header) => header.name.toLowerCase() === name.toLowerCase(),
  )?.value ?? "";
}

async function loadMessages(accessToken: string, ids: string[]) {
  const output: GmailMessage[] = [];
  for (let index = 0; index < ids.length; index += 10) {
    const batch = ids.slice(index, index + 10);
    const messages = await Promise.all(
      batch.map((id) =>
        gmailFetch<GmailMessage>(
          accessToken,
          `messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
        ),
      ),
    );
    output.push(...messages);
  }
  return output;
}

export default function Home() {
  const [profile, setProfile] = useState<CareerProfile>(defaultProfile);
  const [profileKey, setProfileKey] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [tokenExpiresAt, setTokenExpiresAt] = useState(0);
  const [googleReady, setGoogleReady] = useState(false);
  const [jobs, setJobs] = useState<JobMatch[]>([]);
  const [scanned, setScanned] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastScan, setLastScan] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-google-identity="true"]');
    if (existing) {
      if (getGoogleOAuth()) setGoogleReady(true);
      else existing.addEventListener("load", () => setGoogleReady(true), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.dataset.googleIdentity = "true";
    script.onload = () => setGoogleReady(true);
    script.onerror = () => setError("Could not load Google sign-in. Please refresh the page.");
    document.head.appendChild(script);
  }, []);

  useEffect(() => {
    const savedToken = window.sessionStorage.getItem("job-agent-google-token");
    const savedExpiry = Number(window.sessionStorage.getItem("job-agent-google-expiry") || 0);
    const savedEmail = window.sessionStorage.getItem("job-agent-google-email");

    if (savedToken && savedEmail && savedExpiry > Date.now() + 30_000) {
      const key = storageKey(savedEmail);
      setAccessToken(savedToken);
      setTokenExpiresAt(savedExpiry);
      setEmail(savedEmail);
      setConnected(true);
      setProfileKey(key);
      setProfile(readProfile(key, true));
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated && connected && profileKey) {
      window.localStorage.setItem(profileKey, JSON.stringify(profile));
    }
  }, [profile, profileKey, hydrated, connected]);

  const highMatches = useMemo(() => jobs.filter((job) => job.score >= 80).length, [jobs]);

  function update<K extends keyof CareerProfile>(key: K, value: CareerProfile[K]) {
    setProfile((current) => ({ ...current, [key]: value }));
  }

  function requestGoogleToken(prompt = "") {
    return new Promise<{ token: string; expiresAt: number }>((resolve, reject) => {
      if (!clientConfigured()) {
        reject(new Error("Google OAuth Client ID has not been added to the app yet."));
        return;
      }

      const oauth = getGoogleOAuth();
      if (!googleReady || !oauth) {
        reject(new Error("Google sign-in is still loading. Please try again."));
        return;
      }

      const client = oauth.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: GMAIL_READONLY_SCOPE,
        callback: (response) => {
          if (response.error || !response.access_token) {
            reject(new Error(response.error_description || response.error || "Google sign-in failed."));
            return;
          }
          if (!oauth.hasGrantedAllScopes(response, GMAIL_READONLY_SCOPE)) {
            reject(new Error("Gmail read-only permission is required to use this app."));
            return;
          }
          resolve({
            token: response.access_token,
            expiresAt: Date.now() + Math.max(60, response.expires_in || 3600) * 1000,
          });
        },
        error_callback: () => reject(new Error("Google sign-in was closed or could not open.")),
      });

      client.requestAccessToken(prompt ? { prompt } : undefined);
    });
  }

  async function finishConnection(token: string, expiresAt: number) {
    const gmailProfile = await gmailFetch<GmailProfile>(token, "profile");
    const accountEmail = gmailProfile.emailAddress;
    if (!accountEmail) throw new Error("Could not identify the connected Gmail account.");

    const key = storageKey(accountEmail);
    setAccessToken(token);
    setTokenExpiresAt(expiresAt);
    setEmail(accountEmail);
    setConnected(true);
    setProfileKey(key);
    setProfile(readProfile(key, true));
    window.sessionStorage.setItem("job-agent-google-token", token);
    window.sessionStorage.setItem("job-agent-google-expiry", String(expiresAt));
    window.sessionStorage.setItem("job-agent-google-email", accountEmail);
  }

  async function connectGmail(selectAccount = false) {
    setLoading(true);
    setError("");
    try {
      const auth = await requestGoogleToken(selectAccount ? "select_account" : "");
      await finishConnection(auth.token, auth.expiresAt);
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : "Could not connect Gmail.");
    } finally {
      setLoading(false);
    }
  }

  async function ensureToken() {
    if (accessToken && tokenExpiresAt > Date.now() + 60_000) return accessToken;
    const auth = await requestGoogleToken("");
    await finishConnection(auth.token, auth.expiresAt);
    return auth.token;
  }

  async function scanGmail() {
    if (!connected) return;
    setLoading(true);
    setError("");
    try {
      const token = await ensureToken();
      const params = new URLSearchParams({ q: JOB_QUERY, maxResults: "50" });
      const list = await gmailFetch<GmailList>(token, `messages?${params.toString()}`);
      const ids = (list.messages ?? []).map((message) => message.id).slice(0, 50);
      const messages = await loadMessages(token, ids);

      const emailJobs: EmailJobInput[] = messages.map((message) => ({
        id: message.id,
        subject: getHeader(message, "Subject"),
        from: getHeader(message, "From"),
        snippet: message.snippet ?? "",
        date: getHeader(message, "Date") ||
          (message.internalDate ? new Date(Number(message.internalDate)).toISOString() : undefined),
      }));

      const ranked = rankJobs(emailJobs, profile).slice(0, 40);
      setJobs(ranked);
      setScanned(messages.length);
      setLastScan(new Date().toISOString());
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : "Could not scan Gmail.");
    } finally {
      setLoading(false);
    }
  }

  function disconnect() {
    const token = accessToken;
    const oauth = getGoogleOAuth();
    if (token && oauth) oauth.revoke(token);

    window.sessionStorage.removeItem("job-agent-google-token");
    window.sessionStorage.removeItem("job-agent-google-expiry");
    window.sessionStorage.removeItem("job-agent-google-email");
    setAccessToken(null);
    setTokenExpiresAt(0);
    setConnected(false);
    setEmail(null);
    setJobs([]);
    setScanned(0);
    setLastScan(null);
    setProfileKey(null);
    setProfile({ ...defaultProfile });
  }

  function resetProfile() {
    setProfile({ ...defaultProfile });
    setJobs([]);
    setScanned(0);
    setLastScan(null);
  }

  const setupMissing = !clientConfigured();

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <div className="brandMark">J</div>
          <div>
            <strong>Job Match Agent</strong>
            <span>Gmail → ranked opportunities</span>
          </div>
        </div>
        <div className={`connection ${connected ? "connected" : ""}`}>
          <span className="dot" />
          {connected ? email || "Gmail connected" : "Gmail required"}
        </div>
      </header>

      <section className="hero">
        <div>
          <p className="eyebrow">PERSONAL JOB SEARCH AGENT</p>
          <h1>{connected ? "Turn job-alert emails into a focused shortlist." : "Connect Gmail to start your job search agent."}</h1>
          <p className="lede">
            {connected
              ? "Your Gmail account identifies your personal workspace. Define the roles, skills, seniority, locations, and deal-breakers that matter to you, then rank your recent job alerts."
              : "Gmail is required for this app. Google grants a short-lived read-only access token directly to your browser; the app cannot send, delete, archive, or modify your email."}
          </p>
        </div>
        <div className="heroActions">
          {connected ? (
            <>
              <button className="button secondary" onClick={() => void connectGmail(true)} disabled={loading}>Switch Gmail account</button>
              <button className="button primary" disabled={loading} onClick={scanGmail}>
                {loading ? "Working…" : "Scan job emails"}
              </button>
            </>
          ) : (
            <button className="button primary" disabled={loading || setupMissing || !googleReady} onClick={() => void connectGmail()}>
              {loading ? "Connecting…" : "Connect Gmail to continue"}
            </button>
          )}
        </div>
      </section>

      {!connected ? (
        <div className="workspace" style={{ gridTemplateColumns: "1fr", marginTop: 18 }}>
          <section className="panel resultsPanel">
            {error && <div className="alert">{error}</div>}
            {setupMissing && (
              <div className="alert">
                One setup item remains: add the Google Web OAuth Client ID to the app. No client secret or Vercel environment variables are required.
              </div>
            )}
            <div className="emptyState">
              <div className="emptyIcon">✉</div>
              <h3>Gmail sign-in is required</h3>
              <p>
                Connect your Google account first. The app requests only Gmail read-only access, then creates a separate career profile for that Gmail account.
              </p>
              <button className="button primary" disabled={loading || setupMissing || !googleReady} onClick={() => void connectGmail()}>
                {setupMissing ? "Google Client ID needed" : googleReady ? "Connect Gmail" : "Loading Google sign-in…"}
              </button>
            </div>
          </section>
        </div>
      ) : (
        <>
          <section className="stats">
            <div className="stat"><span>Emails scanned</span><strong>{scanned}</strong></div>
            <div className="stat"><span>Matches shown</span><strong>{jobs.length}</strong></div>
            <div className="stat"><span>80%+ matches</span><strong>{highMatches}</strong></div>
            <div className="stat"><span>Minimum score</span><strong>{profile.minimumMatch}%</strong></div>
          </section>

          <div className="workspace">
            <aside className="panel profilePanel">
              <div className="panelHeading">
                <div><p className="eyebrow">STEP 1</p><h2>Career profile</h2></div>
                <span className="saved">Personal</span>
              </div>

              <div className="profileIdentity">
                <div>
                  <strong>{profile.profileName || "My job search"}</strong>
                  <span>{email ? `Saved for ${email}` : "Gmail account"}</span>
                </div>
                <button type="button" className="resetLink" onClick={resetProfile}>Reset</button>
              </div>

              <label>
                Profile name
                <span>Optional label</span>
                <input value={profile.profileName} onChange={(event) => update("profileName", event.target.value)} placeholder="My job search" />
              </label>

              <label>
                Target roles
                <span>One per line or comma-separated</span>
                <textarea value={profile.targetRoles} onChange={(event) => update("targetRoles", event.target.value)} placeholder={"Senior Data Scientist\nMachine Learning Engineer\nSenior Geophysicist"} />
              </label>

              <label>
                Skills
                <span>Technical and domain skills</span>
                <textarea value={profile.skills} onChange={(event) => update("skills", event.target.value)} placeholder="Python, PyTorch, machine learning, seismic interpretation" />
              </label>

              <label>
                Preferred locations
                <span>Cities, states, or regions</span>
                <textarea value={profile.preferredLocations} onChange={(event) => update("preferredLocations", event.target.value)} placeholder={"Houston, TX\nTexas"} />
              </label>

              <label>
                Preferred seniority
                <span>Levels or title keywords</span>
                <input value={profile.seniorityKeywords} onChange={(event) => update("seniorityKeywords", event.target.value)} placeholder="senior, staff, principal, lead" />
              </label>

              <label>
                Industry keywords
                <span>Domains you want to prioritize</span>
                <input value={profile.industryKeywords} onChange={(event) => update("industryKeywords", event.target.value)} placeholder="energy, geophysics, AI" />
              </label>

              <label>
                Deal-breaker keywords
                <span>Lower the score when found</span>
                <input value={profile.avoidKeywords} onChange={(event) => update("avoidKeywords", event.target.value)} placeholder="internship, commission only, relocation required" />
              </label>

              <div className="toggleRow">
                <div><strong>Remote roles</strong><span>Include remote jobs as preferred</span></div>
                <button type="button" className={`toggle ${profile.remoteOkay ? "on" : ""}`} aria-pressed={profile.remoteOkay} onClick={() => update("remoteOkay", !profile.remoteOkay)}><span /></button>
              </div>

              <label>
                Minimum match: <b>{profile.minimumMatch}%</b>
                <input className="range" type="range" min="20" max="95" step="5" value={profile.minimumMatch} onChange={(event) => update("minimumMatch", Number(event.target.value))} />
              </label>
            </aside>

            <section className="panel resultsPanel">
              <div className="panelHeading">
                <div><p className="eyebrow">STEP 2</p><h2>Best matches</h2></div>
                {lastScan && <span className="saved">Updated {new Date(lastScan).toLocaleString()}</span>}
              </div>

              {error && <div className="alert">{error}</div>}

              {jobs.length === 0 ? (
                <div className="emptyState">
                  <div className="emptyIcon">↗</div>
                  <h3>{profile.profileName || "Your profile"} is ready</h3>
                  <p>Complete your preferences, then scan the last 30 days of job-related email.</p>
                  <button className="button primary" disabled={loading} onClick={scanGmail}>{loading ? "Scanning…" : "Scan job emails"}</button>
                </div>
              ) : (
                <div className="jobList">
                  {jobs.map((job) => (
                    <article className="jobCard" key={job.id}>
                      <div className="scoreWrap">
                        <div className={`score ${job.score >= 80 ? "great" : job.score >= 65 ? "good" : "fair"}`}>{job.score}<small>%</small></div>
                        <span>match</span>
                      </div>
                      <div className="jobBody">
                        <div className="jobTopline">
                          <div><h3>{job.title}</h3><p>{job.company} · {job.location} · {job.source}</p></div>
                          <a href={job.emailUrl} target="_blank" rel="noreferrer" className="openLink">Open email ↗</a>
                        </div>
                        <div className="reasonRow">
                          {job.reasons.map((reason) => <span className={reason.startsWith("Caution:") ? "caution" : ""} key={reason}>{reason}</span>)}
                        </div>
                        <p className="snippet">{job.snippet}</p>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>
        </>
      )}

      <footer>
        Gmail is required and accessed read-only. Google access tokens stay in the browser session and career profiles are separated by Gmail account on this device.
      </footer>
    </main>
  );
}
