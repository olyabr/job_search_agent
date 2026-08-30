# Job Match Agent

A privacy-conscious Next.js app that reads **job-related Gmail messages with read-only permission**, extracts likely opportunities, and ranks them against a career profile.

## MVP features

- Google OAuth connection to Gmail
- Gmail scope is `gmail.readonly` only
- OAuth state validation
- Encrypted HTTP-only session cookie for Google tokens
- Career profile stored locally in the browser
- Scans up to 50 recent job-related emails from the last 30 days
- Recognizes common alerts from Indeed, LinkedIn, Rigzone, ZipRecruiter, Glassdoor, and generic job emails
- Transparent 0–100 matching based on role, skills, preferred location/remote fit, and industry keywords
- Deduplicated, ranked results with explanations
- Direct link back to the source email
- Google token revocation on disconnect

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

If the OAuth application is still in testing mode, add the Gmail account you want to use as a test user.

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
- Career-profile fields are stored in browser `localStorage` in this MVP.
- Gmail is scanned only when the user presses **Scan job emails**.
- Disconnect attempts to revoke the Google token and always clears the local session.

For a multi-user production product, move OAuth tokens and career profiles to a proper encrypted database associated with authenticated user accounts. That server-side persistence is also needed for unattended daily scans.

## Matching logic

The initial matcher is deliberately transparent rather than AI-generated. It considers:

- similarity between the inferred job title and target roles
- skills appearing in the subject/snippet
- preferred location or remote fit
- industry/domain keywords

This is a good baseline for testing. A later version can add an LLM-based job-description/resume evaluator while keeping this deterministic score as a guardrail.

## Next milestones

1. Persist user profiles and OAuth tokens in a database.
2. Add scheduled daily scans.
3. Follow application links and ingest full job descriptions where permitted.
4. Add resume upload and AI-based fit analysis.
5. Add Apply / Consider / Skip workflow and application tracking.
6. Add recruiter/rejection/interview email classification.
7. Add tailored resume and cover-letter generation with explicit user approval.

## Important automation note

This project currently focuses on finding and ranking jobs. Automatic submission should only be added for employer/ATS channels that permit automation. Do not build credential-sharing or mass-click automation against sites that prohibit it.
