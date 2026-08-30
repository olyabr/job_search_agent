"use client";

import { useEffect, useMemo, useState } from "react";
import type { CareerProfile, JobMatch } from "@/lib/job-match";

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

type ScanResult = {
  jobs: JobMatch[];
  scanned: number;
  matched: number;
  generatedAt: string;
};

type AuthStatus = {
  connected: boolean;
  email?: string | null;
};

function storageKey(email: string | null) {
  return `job-agent-profile:${(email || "guest").toLowerCase()}`;
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

export default function Home() {
  const [profile, setProfile] = useState<CareerProfile>(defaultProfile);
  const [profileKey, setProfileKey] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [jobs, setJobs] = useState<JobMatch[]>([]);
  const [scanned, setScanned] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastScan, setLastScan] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      let status: AuthStatus = { connected: false, email: null };
      try {
        const response = await fetch("/api/auth/status", { cache: "no-store" });
        status = (await response.json()) as AuthStatus;
      } catch {
        status = { connected: false, email: null };
      }

      if (cancelled) return;
      const accountEmail = status.email ?? null;
      const key = storageKey(accountEmail);
      setConnected(status.connected);
      setEmail(accountEmail);
      setProfileKey(key);
      setProfile(readProfile(key, Boolean(accountEmail)));
      setHydrated(true);
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (hydrated && profileKey) {
      window.localStorage.setItem(profileKey, JSON.stringify(profile));
    }
  }, [profile, profileKey, hydrated]);

  const highMatches = useMemo(() => jobs.filter((job) => job.score >= 80).length, [jobs]);

  function update<K extends keyof CareerProfile>(key: K, value: CareerProfile[K]) {
    setProfile((current) => ({ ...current, [key]: value }));
  }

  async function scanGmail() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/gmail/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile }),
      });
      const data = (await response.json()) as ScanResult & { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not scan Gmail.");
      setJobs(data.jobs);
      setScanned(data.scanned);
      setLastScan(data.generatedAt);
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : "Could not scan Gmail.");
    } finally {
      setLoading(false);
    }
  }

  async function disconnect() {
    await fetch("/api/auth/google/disconnect", { method: "POST" });
    const guestKey = storageKey(null);
    setConnected(false);
    setEmail(null);
    setJobs([]);
    setScanned(0);
    setLastScan(null);
    setProfileKey(guestKey);
    setProfile(readProfile(guestKey));
  }

  function resetProfile() {
    setProfile({ ...defaultProfile });
    setJobs([]);
    setScanned(0);
    setLastScan(null);
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <div className="brandMark">J</div>
          <div>
            <strong>Job Match Agent</strong>
            <span>Inbox → ranked opportunities</span>
          </div>
        </div>
        <div className={`connection ${connected ? "connected" : ""}`}>
          <span className="dot" />
          {connected ? email || "Gmail connected" : "Gmail not connected"}
        </div>
      </header>

      <section className="hero">
        <div>
          <p className="eyebrow">PERSONAL JOB SEARCH AGENT</p>
          <h1>Turn job-alert emails into a focused shortlist.</h1>
          <p className="lede">
            Every Gmail account gets its own career profile. Define the roles, skills, seniority,
            locations, and deal-breakers that matter to you, then rank your recent job alerts.
          </p>
        </div>
        <div className="heroActions">
          {connected ? (
            <button className="button secondary" onClick={disconnect}>Switch Gmail account</button>
          ) : (
            <a className="button primary" href="/api/auth/google/start">Connect Gmail</a>
          )}
          <button className="button primary" disabled={!connected || loading} onClick={scanGmail}>
            {loading ? "Scanning…" : "Scan job emails"}
          </button>
        </div>
      </section>

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
              <span>{email ? `Saved for ${email}` : "Connect Gmail to use a personal profile"}</span>
            </div>
            <button type="button" className="resetLink" onClick={resetProfile}>Reset</button>
          </div>

          <label>
            Profile name
            <span>Optional label</span>
            <input
              value={profile.profileName}
              onChange={(event) => update("profileName", event.target.value)}
              placeholder="My job search"
            />
          </label>

          <label>
            Target roles
            <span>One per line or comma-separated</span>
            <textarea
              value={profile.targetRoles}
              onChange={(event) => update("targetRoles", event.target.value)}
              placeholder={"Senior Data Scientist\nMachine Learning Engineer\nSenior Geophysicist"}
            />
          </label>

          <label>
            Skills
            <span>Technical and domain skills</span>
            <textarea
              value={profile.skills}
              onChange={(event) => update("skills", event.target.value)}
              placeholder="Python, PyTorch, machine learning, seismic interpretation"
            />
          </label>

          <label>
            Preferred locations
            <span>Cities, states, or regions</span>
            <textarea
              value={profile.preferredLocations}
              onChange={(event) => update("preferredLocations", event.target.value)}
              placeholder={"Houston, TX\nTexas"}
            />
          </label>

          <label>
            Preferred seniority
            <span>Levels or title keywords</span>
            <input
              value={profile.seniorityKeywords}
              onChange={(event) => update("seniorityKeywords", event.target.value)}
              placeholder="senior, staff, principal, lead"
            />
          </label>

          <label>
            Industry keywords
            <span>Domains you want to prioritize</span>
            <input
              value={profile.industryKeywords}
              onChange={(event) => update("industryKeywords", event.target.value)}
              placeholder="energy, geophysics, AI"
            />
          </label>

          <label>
            Deal-breaker keywords
            <span>Lower the score when found</span>
            <input
              value={profile.avoidKeywords}
              onChange={(event) => update("avoidKeywords", event.target.value)}
              placeholder="internship, commission only, relocation required"
            />
          </label>

          <div className="toggleRow">
            <div><strong>Remote roles</strong><span>Include remote jobs as preferred</span></div>
            <button
              type="button"
              className={`toggle ${profile.remoteOkay ? "on" : ""}`}
              aria-pressed={profile.remoteOkay}
              onClick={() => update("remoteOkay", !profile.remoteOkay)}
            ><span /></button>
          </div>

          <label>
            Minimum match: <b>{profile.minimumMatch}%</b>
            <input
              className="range"
              type="range"
              min="20"
              max="95"
              step="5"
              value={profile.minimumMatch}
              onChange={(event) => update("minimumMatch", Number(event.target.value))}
            />
          </label>
        </aside>

        <section className="panel resultsPanel">
          <div className="panelHeading">
            <div><p className="eyebrow">STEP 2</p><h2>Best matches</h2></div>
            {lastScan && <span className="saved">Updated {new Date(lastScan).toLocaleString()}</span>}
          </div>

          {error && <div className="alert">{error}</div>}

          {!connected ? (
            <div className="emptyState">
              <div className="emptyIcon">✉</div>
              <h3>Connect your Gmail</h3>
              <p>
                Each person connects their own account. The app requests Gmail read-only permission
                and cannot send, delete, or edit email.
              </p>
              <a className="button primary" href="/api/auth/google/start">Connect Gmail</a>
            </div>
          ) : jobs.length === 0 ? (
            <div className="emptyState">
              <div className="emptyIcon">↗</div>
              <h3>{profile.profileName || "Your profile"} is ready</h3>
              <p>Complete your preferences, then scan the last 30 days of job-related email.</p>
              <button className="button primary" disabled={loading} onClick={scanGmail}>
                {loading ? "Scanning…" : "Scan job emails"}
              </button>
            </div>
          ) : (
            <div className="jobList">
              {jobs.map((job) => (
                <article className="jobCard" key={job.id}>
                  <div className="scoreWrap">
                    <div className={`score ${job.score >= 80 ? "great" : job.score >= 65 ? "good" : "fair"}`}>
                      {job.score}<small>%</small>
                    </div>
                    <span>match</span>
                  </div>
                  <div className="jobBody">
                    <div className="jobTopline">
                      <div>
                        <h3>{job.title}</h3>
                        <p>{job.company} · {job.location} · {job.source}</p>
                      </div>
                      <a href={job.emailUrl} target="_blank" rel="noreferrer" className="openLink">Open email ↗</a>
                    </div>
                    <div className="reasonRow">
                      {job.reasons.map((reason) => (
                        <span className={reason.startsWith("Caution:") ? "caution" : ""} key={reason}>{reason}</span>
                      ))}
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
        Gmail content is processed only when you press Scan. Profiles are separated by connected Gmail account on this device.
      </footer>
    </main>
  );
}
