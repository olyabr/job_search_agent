# Job Match Agent

A privacy-conscious Next.js app that reads **job-related Gmail messages with read-only permission**, extracts likely opportunities, and ranks them against a personal career profile.

## MVP features

- Gmail connection using Google Identity Services in the browser
- Gmail scope is `gmail.readonly` only
- No Google client secret is stored by the app
- No Vercel environment variables are required for Gmail authorization
- Google email address acts as the user identity
- Separate career profile for each connected Gmail account on a device
- Google access token is short-lived and kept in browser `sessionStorage`
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
2. Google issues a short-lived Gmail read-only access token directly to that browser session.
3. Their career profile is stored under a key derived from their connected Gmail address in that browser's `localStorage`.
4. Switching Gmail accounts loads a different profile instead of reusing the previous person's settings.

This provides simple account separation without storing Gmail refresh tokens or client secrets on the server. It does **not** yet provide cross-device profile sync or unattended background scans.

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

## Google OAuth setup

Only a **Google Web OAuth Client ID** is needed. Client IDs are public identifiers; no client secret is used by this MVP.

In Google Cloud Console:

1. Create or select a Google Cloud project.
2. Enable the **Gmail API**.
3. Configure the OAuth consent screen.
4. Create an **OAuth 2.0 Client ID** for a **Web application**.
5. Add the deployed site as an **Authorized JavaScript origin**:

```text
https://job-search-agent-olive.vercel.app
```

For local development also add:

```text
http://localhost:3000
```

6. If the OAuth application is in testing mode, add every Gmail account that should use the app as an OAuth test user.
7. Copy the generated Client ID and replace `PASTE_GOOGLE_CLIENT_ID_HERE` in `app/page.tsx`.

No redirect URI is required for this popup token flow.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Deploy to Vercel

Deploy the repository normally. Gmail authorization does not require `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`, or any other Vercel environment variable in this browser-token MVP.

## Security model

- The app never asks for or stores a Gmail password.
- Gmail permission is read-only; the app cannot send, delete, archive, label, or edit mail.
- The Google access token is short-lived and kept in browser `sessionStorage`, not persisted in the repository or Vercel configuration.
- Career-profile fields stay in the user's browser in this MVP.
- Gmail is scanned only when the user presses **Scan job emails**.
- Disconnect revokes the current Google access token when possible and clears the browser session.

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

1. Add encrypted database persistence for account profiles if cross-device sync is needed.
2. Add scheduled daily scans using a server-side OAuth flow only if unattended processing becomes necessary.
3. Follow application links and ingest full job descriptions where permitted.
4. Add resume upload and AI-based fit analysis.
5. Add Apply / Consider / Skip workflow and application tracking.
6. Add recruiter/rejection/interview email classification.
7. Add tailored resume and cover-letter generation with explicit user approval.

## Important automation note

This project currently focuses on finding and ranking jobs. Automatic submission should only be added for employer/ATS channels that permit automation. Do not build credential-sharing or mass-click automation against sites that prohibit it.
