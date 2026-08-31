import { NextResponse } from "next/server";

type RemotiveJob = {
  id: number;
  url: string;
  title: string;
  company_name: string;
  category?: string;
  job_type?: string;
  publication_date?: string;
  candidate_required_location?: string;
  salary?: string;
  description?: string;
};

type RemotiveResponse = {
  jobs?: RemotiveJob[];
};

function stripHtml(value = "") {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search")?.trim() ?? "";
  const endpoint = new URL("https://remotive.com/api/remote-jobs");
  endpoint.searchParams.set("limit", "20");
  if (search) endpoint.searchParams.set("search", search);

  try {
    const response = await fetch(endpoint, {
      headers: { Accept: "application/json" },
      next: { revalidate: 21600 },
    });

    if (!response.ok) {
      return NextResponse.json({ jobs: [], error: `Remotive returned ${response.status}` }, { status: 502 });
    }

    const payload = (await response.json()) as RemotiveResponse;
    const jobs = (payload.jobs ?? []).map((job) => ({
      id: `remotive:${job.id}`,
      subject: job.title,
      from: "",
      title: job.title,
      company: job.company_name,
      location: job.candidate_required_location || "Remote",
      source: "Remotive",
      applyUrl: job.url,
      date: job.publication_date,
      snippet: [job.category, job.job_type?.replace(/_/g, " "), job.salary, stripHtml(job.description).slice(0, 320)]
        .filter(Boolean)
        .join(" · "),
    }));

    return NextResponse.json({ jobs });
  } catch (error) {
    return NextResponse.json(
      { jobs: [], error: error instanceof Error ? error.message : "Could not load live jobs" },
      { status: 502 },
    );
  }
}
