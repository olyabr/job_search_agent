# Job Match Agent

A privacy-conscious Next.js app that reads **job-related Gmail messages with read-only permission**, extracts likely opportunities, and ranks them against a personal career profile.

## MVP features

- Google OAuth connection to Gmail
- Gmail scope is `gmail.readonly` only
- Google email address acts as the user identity
- Separate career profile for each connected Gmail account on a device
- OAuth state validation
- Encrypted HTTP-only session cookie for Google tokens
- Scans up to 50 recent job-related emails from the last 30 days
- Recognizes common alerts from Indeed, LinkedIn, Rigzone, ZipRecruiter, Glassdoor, and generic job emails
- Transparent 0–100 matching based on role, skills, seniority, preferred location/remote fit, and industry keywords
- User-defined deal-breaker keywords reduce a job's score
- Deduplicated, ranked results with explanations
- Direct link back to the source email
- Google token revocation on disconnect/switch account

## Multi-user behavior

The same deployed website can be used by multiple people.

1. Each person connects their own Google/Gmail account.
2. Their Gmail OAuth session is held in an encrypted HTTP-only cookie in their browser.
3. Their career profile is stored under a key derived from their connected Gmail address in that browser's `localStorage`.
4. Switching Gmail accounts loads a different profile instead of reusing the previous person's settings.

This gives the MVP safe account separation for normal use on separate devices and browser sessions. It does **not** yet provide cross-device profile sync or unattended background scans. Those require server-side encrypted persistence and are the next infrastructure milestone.

## Career profile settings

Each user can customize:

- profile name
- target job titles
- skills
- preferred locations
- preferred seniority/title keywords
- industry/domain keywords
- deal-breaker keywords
- whether remote roles are preferred
- minimum match threshold

## Run locally

### 1. Install

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

### 2. Configure Google OAuth

In Google Cloud Console:

1. Create or select a Google Cloud project.
2. Enable the **Gmail API**.
3. Configure the OAuth consent screen.
4. Create an **OAuth 2.0 Client ID** for a Web application.
5. Add this authorized redirect URI for local development:

```text
http://localhost:3000/api/auth/google/callback
```

If the OAuth application is still in testing mode, add every Gmail account that should test the app as an OAuth test user.

### 3. Environment variables

Copy `.env.example` to `.env.local` and fill in:

```bash
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
SESSION_SECRET=use-a-long-random-secret-at-least-32-characters
```

`GOOGLE_REDIRECT_URI` is optional locally. If omitted, the callback URL is generated from the incoming request origin.

## Deploy to Vercel

1. Import `olyabr/job_search_agent` into Vercel.
2. Add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `SESSION_SECRET` as encrypted environment variables.
3. Add the production callback URL to the Google OAuth client, for example:

```text
https://your-app.vercel.app/api/auth/google/callback
```

4. Redeploy after adding environment variables.

## Security model

- The app never asks for or stores a Gmail password.
- Gmail permission is read-only; the app cannot send, delete, archive, label, or edit mail.
- Google OAuth access/refresh tokens are encrypted with AES-256-GCM before being placed in an HTTP-only cookie.
- Career-profile fields stay in the user's browser in this MVP.
- Gmail is scanned only when the user presses **Scan job emails**.
- Disconnect attempts to revoke the Google token and always clears the local OAuth session.

## Matching logic

The initial matcher is deliberately transparent rather than AI-generated. It considers:

- similarity between the inferred job title and target roles
- skills appearing in the subject/snippet
- preferred location or remote fit
- industry/domain keywords
- preferred seniority/title keywords
- deal-breaker keywords as a score penalty

A later version can add an LLM-based job-description/resume evaluator while keeping this deterministic score as a guardrail.

## Next milestones

1. Add encrypted database persistence for account profiles and OAuth tokens.
2. Add scheduled daily scans and notifications.
3. Follow application links and ingest full job descriptions where permitted.
4. Add resume upload and AI-based fit analysis.
5. Add Apply / Consider / Skip workflow and application tracking.
6. Add recruiter/rejection/interview email classification.
7. Add tailored resume and cover-letter generation with explicit user approval.

## Important automation note

This project currently focuses on finding and ranking jobs. Automatic submission should only be added for employer/ATS channels that permit automation. Do not build credential-sharing or mass-click automation against sites that prohibit it.
