"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import {
  rankJobs,
  type CareerProfile,
  type EmailJobInput,
  type JobMatch,
} from "@/lib/job-match";

const GOOGLE_CLIENT_ID = "1000693491801-93th0r0hrdsd7iol5an9jl1ks46s5gp1.apps.googleusercontent.com";
const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const GUEST_PROFILE_KEY = "job-agent-profile:guest";
const JOB_QUERY = [
  "newer_than:30d",
  "-in:spam",
  "-in:trash",
  "{subject:job subject:jobs subject:opportunity subject:position subject:role subject:hiring subject:career",
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
  remoteOkay: false,
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
type GmailPart = {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
};
type GmailMessage = {
  id: string;
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart & {
    headers?: Array<{ name: string; value: string }>;
  };
};

type LiveJobsResponse = { jobs?: EmailJobInput[]; error?: string };
type ResumeResponse = {
  fileName?: string;
  profile?: Partial<CareerProfile>;
  error?: string;
};

function storageKey(email: string) {
  return `job-agent-profile:${email.toLowerCase()}`;
}

function readProfile(key: string) {
  const stored = window.localStorage.getItem(key);
  if (!stored) return { ...defaultProfile };
  try {
    return { ...defaultProfile, ...(JSON.parse(stored) as Partial<CareerProfile>) };
  } catch {
    return { ...defaultProfile };
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
    let detail = "";
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      detail = body.error?.message ?? "";
    } catch {
      // Keep the status-only fallback.
    }
    throw new Error(detail ? `Gmail request failed (${response.status}): ${detail}` : `Gmail request failed (${response.status}).`);
  }
  return (await response.json()) as T;
}

function getHeader(message: GmailMessage, name: string) {
  return message.payload?.headers?.find(
    (header) => header.name.toLowerCase() === name.toLowerCase(),
  )?.value ?? "";
}

function decodeGmailData(data = "") {
  if (!data) return "";
  try {
    const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
    const binary = window.atob(normalized);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return "";
  }
}

function collectBodies(part?: GmailPart): { html: string; text: string } {
  if (!part) return { html: "", text: "" };
  let html = "";
  let text = "";
  const own = decodeGmailData(part.body?.data);
  if (own) {
    if (part.mimeType?.includes("html")) html += own;
    else if (part.mimeType?.startsWith("text/")) text += own;
  }
  for (const child of part.parts ?? []) {
    const nested = collectBodies(child);
    html += `\n${nested.html}`;
    text += `\n${nested.text}`;
  }
  return { html, text };
}

function cleanUrl(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/[)>.,]+$/, "")
    .trim();
}

function looksLikeJobUrl(url: string) {
  const lower = url.toLowerCase();
  if (!/^https?:\/\//.test(lower)) return false;
  if (/unsubscribe|preferences|privacy|support|help|logo|image|pixel|tracking/.test(lower)) return false;
  return /job|jobs|career|careers|position|opening|apply|indeed|linkedin|ziprecruiter|glassdoor|greenhouse|lever\.co|workday|smartrecruiters|myworkdayjobs/.test(lower);
}

function extractJobLinks(message: GmailMessage) {
  const { html, text } = collectBodies(message.payload);
  const links: Array<{ url: string; label: string }> = [];

  if (html) {
    try {
      const doc = new DOMParser().parseFromString(html, "text/html");
      for (const anchor of Array.from(doc.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
        const url = cleanUrl(anchor.href);
        const label = anchor.textContent?.replace(/\s+/g, " ").trim() ?? "";
        if (looksLikeJobUrl(url)) links.push({ url, label });
      }
    } catch {
      // Plain-text URL extraction below still runs.
    }
  }

  const textUrls = `${text}\n${html}`.match(/https?:\/\/[^\s"'<>]+/gi) ?? [];
  for (const raw of textUrls) {
    const url = cleanUrl(raw);
    if (looksLikeJobUrl(url)) links.push({ url, label: "" });
  }

  const seen = new Set<string>();
  return links
    .filter(({ url }) => {
      if (seen.has(url)) return false;
      seen.add(url);
      return true;
    })
    .slice(0, 8);
}

async function loadMessages(accessToken: string, ids: string[]) {
  const output: GmailMessage[] = [];
  for (let index = 0; index < ids.length; index += 8) {
    const batch = ids.slice(index, index + 8);
    const messages = await Promise.all(
      batch.map((id) => gmailFetch<GmailMessage>(accessToken, `messages/${id}?format=full`)),
    );
    output.push(...messages);
  }
  return output;
}

function firstTerm(value: string) {
  return value.split(/[\n,;]+/).map((item) => item.trim()).find(Boolean) ?? "";
}

function jobBoardLinks(profile: CareerProfile) {
  const role = firstTerm(profile.targetRoles) || firstTerm(profile.skills) || "jobs";
  const location = firstTerm(profile.preferredLocations);
  const q = encodeURIComponent(role);
  const l = encodeURIComponent(location);
  return [
    { name: "Indeed", href: `https://www.indeed.com/jobs?q=${q}${location ? `&l=${l}` : ""}` },
    { name: "LinkedIn", href: `https://www.linkedin.com/jobs/search/?keywords=${q}${location ? `&location=${l}` : ""}` },
    { name: "ZipRecruiter", href: `https://www.ziprecruiter.com/jobs-search?search=${q}${location ? `&location=${l}` : ""}` },
    { name: "Glassdoor", href: `https://www.glassdoor.com/Job/jobs.htm?sc.keyword=${q}` },
    { name: "Google Jobs", href: `https://www.google.com/search?q=${encodeURIComponent(`${role} jobs ${location}`.trim())}` },
  ];
}

export default function Home() {
  const [profile, setProfile] = useState<CareerProfile>(defaultProfile);
  const [profileKey, setProfileKey] = useState(GUEST_PROFILE_KEY);
  const [connected, setConnected] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [tokenExpiresAt, setTokenExpiresAt] = useState(0);
  const [googleReady, setGoogleReady] = useState(false);
  const [jobs, setJobs] = useState<JobMatch[]>([]);
  const [scanned, setScanned] = useState(0);
  const [liveJobs, setLiveJobs] = useState(0);
  const [loading, setLoading] = useState(false);
  const [resumeLoading, setResumeLoading] = useState(false);
  const [resumeStatus, setResumeStatus] = useState("");
  const [error, setError] = useState("");
  const [lastScan, setLastScan] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-google-identity="true"]');
    if (existing) {
      if (getGoogleOAuth()) setGoogleReady(true);
      else existing.addEventListener("load", () => setGoogleReady(true), { once: true });
    } else {
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.dataset.googleIdentity = "true";
      script.onload = () => setGoogleReady(true);
      script.onerror = () => setError("Could not load Google sign-in. You can still search jobs without Gmail.");
      document.head.appendChild(script);
    }

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
      setProfile(readProfile(key));
    } else {
      setProfileKey(GUEST_PROFILE_KEY);
      setProfile(readProfile(GUEST_PROFILE_KEY));
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) window.localStorage.setItem(profileKey, JSON.stringify(profile));
  }, [profile, profileKey, hydrated]);

  const profileReady = useMemo(
    () => [profile.targetRoles, profile.skills, profile.preferredLocations, profile.industryKeywords, profile.seniorityKeywords]
      .some((value) => value.trim().length > 0),
    [profile],
  );

  const highMatches = useMemo(
    () => (profileReady ? jobs.filter((job) => job.score >= 80).length : 0),
    [jobs, profileReady],
  );
  const boards = useMemo(() => jobBoardLinks(profile), [profile]);

  function update<K extends keyof CareerProfile>(key: K, value: CareerProfile[K]) {
    setProfile((current) => ({ ...current, [key]: value }));
  }

  function requestGoogleToken(prompt = "") {
    return new Promise<{ token: string; expiresAt: number }>((resolve, reject) => {
      if (!clientConfigured()) return reject(new Error("Google OAuth Client ID has not been added to the app yet."));
      const oauth = getGoogleOAuth();
      if (!googleReady || !oauth) return reject(new Error("Google sign-in is still loading. Please try again."));

      const client = oauth.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: GMAIL_READONLY_SCOPE,
        callback: (response) => {
          if (response.error || !response.access_token) {
            reject(new Error(response.error_description || response.error || "Google sign-in failed."));
            return;
          }
          if (!oauth.hasGrantedAllScopes(response, GMAIL_READONLY_SCOPE)) {
            reject(new Error("Gmail read-only permission is required to scan job alerts."));
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
    const existing = window.localStorage.getItem(key);
    if (existing) setProfile(readProfile(key));
    else window.localStorage.setItem(key, JSON.stringify(profile));

    setAccessToken(token);
    setTokenExpiresAt(expiresAt);
    setEmail(accountEmail);
    setConnected(true);
    setProfileKey(key);
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

  async function gmailOpportunities() {
    if (!connected) return { inputs: [] as EmailJobInput[], messages: 0 };
    const token = await ensureToken();
    const params = new URLSearchParams({ q: JOB_QUERY, maxResults: "40" });
    const list = await gmailFetch<GmailList>(token, `messages?${params.toString()}`);
    const ids = (list.messages ?? []).map((message) => message.id).slice(0, 40);
    const messages = await loadMessages(token, ids);

    const inputs = messages.flatMap((message): EmailJobInput[] => {
      const subject = getHeader(message, "Subject");
      const from = getHeader(message, "From");
      const date = getHeader(message, "Date") ||
        (message.internalDate ? new Date(Number(message.internalDate)).toISOString() : undefined);
      const links = extractJobLinks(message);
      return links.map((link, index) => ({
        id: `${message.id}:${index}`,
        subject: link.label && !/^(apply|view|see|learn|click|job)$/i.test(link.label) ? link.label : subject,
        title: link.label && link.label.length > 3 && link.label.length < 120 && !/apply|view job|learn more/i.test(link.label) ? link.label : undefined,
        from,
        snippet: message.snippet ?? "",
        date,
        applyUrl: link.url,
      }));
    });

    return { inputs, messages: messages.length };
  }

  async function liveOpportunities() {
    const search = firstTerm(profile.targetRoles) || firstTerm(profile.skills);
    const response = await fetch(`/api/jobs/remotive?search=${encodeURIComponent(search)}`, { cache: "no-store" });
    const payload = (await response.json()) as LiveJobsResponse;
    if (!response.ok) throw new Error(payload.error || "Could not load live jobs.");
    return payload.jobs ?? [];
  }

  async function findJobs() {
    setLoading(true);
    setError("");
    try {
      const [gmailResult, currentJobs] = await Promise.all([
        gmailOpportunities().catch((gmailError) => {
          setError(gmailError instanceof Error ? `Gmail alerts could not be scanned: ${gmailError.message}` : "Gmail alerts could not be scanned.");
          return { inputs: [] as EmailJobInput[], messages: 0 };
        }),
        liveOpportunities(),
      ]);

      setScanned(gmailResult.messages);
      setLiveJobs(currentJobs.length);
      setJobs(rankJobs([...gmailResult.inputs, ...currentJobs], profile).slice(0, 50));
      setLastScan(new Date().toISOString());
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : "Could not find jobs.");
    } finally {
      setLoading(false);
    }
  }

  async function importResume(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setResumeLoading(true);
    setResumeStatus("");
    setError("");
    try {
      const formData = new FormData();
      formData.append("resume", file);
      const response = await fetch("/api/profile/resume", { method: "POST", body: formData });
      const payload = (await response.json()) as ResumeResponse;
      if (!response.ok || !payload.profile) throw new Error(payload.error || "Could not read resume.");

      setProfile((current) => ({
        ...current,
        profileName: payload.profile?.profileName || current.profileName,
        targetRoles: payload.profile?.targetRoles || current.targetRoles,
        skills: payload.profile?.skills || current.skills,
        seniorityKeywords: payload.profile?.seniorityKeywords || current.seniorityKeywords,
        industryKeywords: payload.profile?.industryKeywords || current.industryKeywords,
      }));
      setJobs([]);
      setResumeStatus(`Imported ${payload.fileName || file.name}. Review the suggested profile below, then find jobs.`);
    } catch (resumeError) {
      setError(resumeError instanceof Error ? resumeError.message : "Could not import resume.");
    } finally {
      setResumeLoading(false);
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
    setProfileKey(GUEST_PROFILE_KEY);
    setProfile(readProfile(GUEST_PROFILE_KEY));
  }

  function resetProfile() {
    setProfile({ ...defaultProfile });
    setJobs([]);
    setScanned(0);
    setLiveJobs(0);
    setLastScan(null);
    setResumeStatus("");
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <div className="brandMark">J</div>
          <div>
            <strong>Job Match Agent</strong>
            <span>Profile → actionable jobs → apply</span>
          </div>
        </div>
        <div className={`connection ${connected ? "connected" : ""}`}>
          <span className="dot" />
          {connected ? email || "Gmail connected" : "Gmail optional"}
        </div>
      </header>

      <section className="hero">
        <div>
          <p className="eyebrow">ACTIONABLE JOB SEARCH</p>
          <h1>Find jobs that fit — and apply to them.</h1>
          <p className="lede">
            Build a profile manually or import a resume. The app ranks real opportunities with application links, searches a live job feed, and can optionally add jobs found in Gmail alerts.
          </p>
        </div>
        <div className="heroActions">
          <button className="button primary" disabled={loading} onClick={findJobs}>{loading ? "Finding jobs…" : "Find recommended jobs"}</button>
          {connected ? (
            <button className="button secondary" onClick={disconnect}>Disconnect Gmail</button>
          ) : (
            <button className="button secondary" disabled={loading || !googleReady} onClick={() => void connectGmail()}>{googleReady ? "Add Gmail alerts" : "Loading Gmail…"}</button>
          )}
        </div>
      </section>

      <section className="stats">
        <div className="stat"><span>Live jobs loaded</span><strong>{liveJobs}</strong></div>
        <div className="stat"><span>Gmail alerts scanned</span><strong>{connected ? scanned : "—"}</strong></div>
        <div className="stat"><span>Recommended jobs</span><strong>{jobs.length}</strong></div>
        <div className="stat"><span>80%+ matches</span><strong>{profileReady ? highMatches : "—"}</strong></div>
      </section>

      <div className="workspace">
        <aside className="panel profilePanel">
          <div className="panelHeading">
            <div><p className="eyebrow">STEP 1</p><h2>Your career profile</h2></div>
            <span className="saved">{profileReady ? "Ready to match" : "Set preferences"}</span>
          </div>

          <div className="resumeImport">
            <div>
              <strong>Import your resume</strong>
              <span>PDF, DOCX, TXT or MD · we suggest roles, skills, seniority and industries</span>
            </div>
            <label className="uploadButton">
              {resumeLoading ? "Reading…" : "Choose resume"}
              <input type="file" accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" onChange={importResume} disabled={resumeLoading} />
            </label>
          </div>
          {resumeStatus && <div className="successNote">{resumeStatus}</div>}

          <div className="profileIdentity">
            <div>
              <strong>{profile.profileName || "My job search"}</strong>
              <span>{connected && email ? `Saved for ${email}` : "Saved on this device"}</span>
            </div>
            <button type="button" className="resetLink" onClick={resetProfile}>Start over</button>
          </div>

          <label>
            Profile name
            <span>Optional label</span>
            <input value={profile.profileName} onChange={(event) => update("profileName", event.target.value)} placeholder="My job search" />
          </label>

          <label>
            Target roles
            <span>One per line or comma-separated</span>
            <textarea value={profile.targetRoles} onChange={(event) => update("targetRoles", event.target.value)} placeholder={"Product Manager\nRegistered Nurse\nSoftware Engineer"} />
          </label>

          <label>
            Skills
            <span>Professional and domain skills</span>
            <textarea value={profile.skills} onChange={(event) => update("skills", event.target.value)} placeholder="project management, Excel, React, patient care" />
          </label>

          <label>
            Preferred locations
            <span>Where you want to work</span>
            <textarea value={profile.preferredLocations} onChange={(event) => update("preferredLocations", event.target.value)} placeholder={"Chicago, IL\nLondon\nBay Area"} />
          </label>

          <label>
            Preferred seniority
            <span>Levels or title keywords</span>
            <input value={profile.seniorityKeywords} onChange={(event) => update("seniorityKeywords", event.target.value)} placeholder="entry level, senior, manager, director" />
          </label>

          <label>
            Industry keywords
            <span>Fields to prioritize</span>
            <input value={profile.industryKeywords} onChange={(event) => update("industryKeywords", event.target.value)} placeholder="healthcare, finance, technology, education" />
          </label>

          <label>
            Deal-breaker keywords
            <span>Lower the score when found</span>
            <input value={profile.avoidKeywords} onChange={(event) => update("avoidKeywords", event.target.value)} placeholder="contract, nights, heavy travel, relocation required" />
          </label>

          <div className="toggleRow">
            <div><strong>Prefer remote roles</strong><span>Give remote jobs a location-match bonus</span></div>
            <button type="button" className={`toggle ${profile.remoteOkay ? "on" : ""}`} aria-pressed={profile.remoteOkay} onClick={() => update("remoteOkay", !profile.remoteOkay)}><span /></button>
          </div>

          <label>
            Minimum match: <b>{profile.minimumMatch}%</b>
            <input className="range" type="range" min="20" max="95" step="5" value={profile.minimumMatch} onChange={(event) => update("minimumMatch", Number(event.target.value))} />
          </label>
        </aside>

        <section className="panel resultsPanel">
          <div className="panelHeading">
            <div><p className="eyebrow">STEP 2</p><h2>Recommended jobs</h2></div>
            {lastScan && <span className="saved">Updated {new Date(lastScan).toLocaleString()}</span>}
          </div>

          {error && <div className="alert">{error}</div>}

          <div className="jobBoards">
            <div className="jobBoardsCopy">
              <strong>Search more job sites</strong>
              <span>Open the same search on major job boards using your target role and location.</span>
            </div>
            <div className="boardLinks">
              {boards.map((board) => <a key={board.name} href={board.href} target="_blank" rel="noreferrer">{board.name} ↗</a>)}
            </div>
          </div>

          {jobs.length === 0 ? (
            <div className="emptyState">
              <div className="emptyIcon">↗</div>
              <h3>{profileReady ? "Ready to find matching openings" : "Start with a resume or a few preferences"}</h3>
              <p>
                {profileReady
                  ? "Find recommended jobs to combine live openings with any actionable links found in your connected Gmail alerts."
                  : "Import a resume or enter target roles and skills. You can still run a broad search, but matching improves once the profile has some detail."}
              </p>
              <button className="button primary" disabled={loading} onClick={findJobs}>{loading ? "Finding jobs…" : "Find recommended jobs"}</button>
            </div>
          ) : (
            <div className="jobList">
              {jobs.map((job) => (
                <article className="jobCard" key={job.id}>
                  <div className="scoreWrap">
                    {profileReady ? (
                      <div className={`score ${job.score >= 80 ? "great" : job.score >= 65 ? "good" : "fair"}`}>{job.score}<small>%</small></div>
                    ) : (
                      <div className="score fair">—</div>
                    )}
                    <span>{profileReady ? "match" : "unranked"}</span>
                  </div>
                  <div className="jobBody">
                    <div className="jobTopline">
                      <div><h3>{job.title}</h3><p>{job.company} · {job.location} · {job.source}</p></div>
                      <div className="jobActions">
                        {job.emailUrl && <a href={job.emailUrl} target="_blank" rel="noreferrer" className="openLink secondaryLink">Source email</a>}
                        <a href={job.applyUrl} target="_blank" rel="noreferrer" className="applyLink">Apply ↗</a>
                      </div>
                    </div>
                    <div className="reasonRow">
                      {profileReady
                        ? job.reasons.map((reason) => <span className={reason.startsWith("Caution:") ? "caution" : ""} key={reason}>{reason}</span>)
                        : <span>Actionable opening — add profile preferences to rank it</span>}
                    </div>
                    <p className="snippet">{job.snippet}</p>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>

      <footer>
        Recommendations only include opportunities with an application link. Gmail is optional and read-only. Resume files are processed to suggest profile fields and are not stored by the app.
      </footer>
    </main>
  );
}
