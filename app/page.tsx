"use client";

import { useEffect, useMemo, useState } from "react";
import type { CareerProfile, JobMatch } from "@/lib/job-match";

const defaultProfile: CareerProfile = {
  targetRoles: "",
  skills: "",
  preferredLocations: "",
  industryKeywords: "",
  remoteOkay: true,
  minimumMatch: 60,
};

type ScanResult = {
  jobs: JobMatch[];
  scanned: number;
  matched: number;
  generatedAt: string;
};

export default function Home() {
  const [profile, setProfile] = useState<CareerProfile>(defaultProfile);
  const [connected, setConnected] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [jobs, setJobs] = useState<JobMatch[]>([]);
  const [scanned, setScanned] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastScan, setLastScan] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem("job-agent-profile");
    if (saved) {
      try {
        setProfile({ ...defaultProfile, ...(JSON.parse(saved) as CareerProfile) });
      } catch {
        // Ignore malformed local data and use defaults.
      }
    }
    setHydrated(true);

    fetch("/api/auth/status", { cache: "no-store" })
      .then((response) => response.json())
      .then((data: { connected: boolean; email?: string | null }) => {
        setConnected(data.connected);
        setEmail(data.email ?? null);
      })
      .catch(() => setConnected(false));
  }, []);

  useEffect(() => {
    if (hydrated) {
      window.localStorage.setItem("job-agent-profile", JSON.stringify(profile));
    }
  }, [profile, hydrated]);

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
    setConnected(false);
    setEmail(null);
    setJobs([]);
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
          <p className="eyebrow">YOUR PRIVATE JOB SEARCH COPILOT</p>
          <h1>Turn job-alert emails into a focused shortlist.</h1>
          <p className="lede">
            Define what you want, connect Gmail with read-only access, and scan recent job alerts.
            The app ranks each opportunity and explains why it matches.
          </p>
        </div>
        <div className="heroActions">
          {connected ? (
            <button className="button secondary" onClick={disconnect}>Disconnect Gmail</button>
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
            <span className="saved">Saved locally</span>
          </div>

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
            Industry keywords
            <span>Helpful for domain-specific ranking</span>
            <input
              value={profile.industryKeywords}
              onChange={(event) => update("industryKeywords", event.target.value)}
              placeholder="energy, geophysics, AI"
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
              <h3>Connect Gmail to start</h3>
              <p>The app requests Gmail read-only permission. It cannot send, delete, or edit email.</p>
              <a className="button primary" href="/api/auth/google/start">Connect Gmail</a>
            </div>
          ) : jobs.length === 0 ? (
            <div className="emptyState">
              <div className="emptyIcon">↗</div>
              <h3>Ready to scan</h3>
              <p>Complete the profile, then scan the last 30 days of job-related email.</p>
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
                      {job.reasons.map((reason) => <span key={reason}>{reason}</span>)}
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
        Gmail content is processed only when you press Scan. Career-profile settings stay in this browser.
      </footer>
    </main>
  );
}
