import { NextResponse } from "next/server";
import { ensureFreshGoogleSession } from "@/lib/google";
import { CareerProfile, EmailJobInput, rankJobs } from "@/lib/job-match";
import { getGmailSession, saveGmailSession } from "@/lib/session";

const JOB_QUERY = [
  "newer_than:30d",
  "-in:spam",
  "-in:trash",
  "{subject:job subject:jobs subject:opportunity subject:position subject:role subject:hiring",
  "from:jobalert.indeed.com from:linkedin.com from:rigzonemail.com",
  "from:ziprecruiter.com from:glassdoor.com}",
].join(" ");

type GmailList = { messages?: Array<{ id: string }> };
type GmailMessage = {
  id: string;
  snippet?: string;
  internalDate?: string;
  payload?: {
    headers?: Array<{ name: string; value: string }>;
  };
};

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

export async function POST(request: Request) {
  const storedSession = await getGmailSession();
  if (!storedSession) {
    return NextResponse.json(
      { error: "Connect Gmail before scanning job emails." },
      { status: 401 },
    );
  }

  try {
    const body = (await request.json()) as { profile?: CareerProfile };
    if (!body.profile) {
      return NextResponse.json({ error: "Career profile is required." }, { status: 400 });
    }

    const refreshed = await ensureFreshGoogleSession(storedSession);
    if (refreshed.changed) await saveGmailSession(refreshed.session);

    const params = new URLSearchParams({ q: JOB_QUERY, maxResults: "50" });
    const list = await gmailFetch<GmailList>(
      refreshed.session.accessToken,
      `messages?${params.toString()}`,
    );

    const ids = (list.messages ?? []).map((message) => message.id).slice(0, 50);
    const messages = await loadMessages(refreshed.session.accessToken, ids);

    const emailJobs: EmailJobInput[] = messages.map((message) => ({
      id: message.id,
      subject: getHeader(message, "Subject"),
      from: getHeader(message, "From"),
      snippet: message.snippet ?? "",
      date: getHeader(message, "Date") ||
        (message.internalDate ? new Date(Number(message.internalDate)).toISOString() : undefined),
    }));

    const jobs = rankJobs(emailJobs, body.profile).slice(0, 40);
    return NextResponse.json({
      jobs,
      scanned: messages.length,
      matched: jobs.length,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not scan Gmail.";
    const status = message.includes("reconnect Gmail") ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
