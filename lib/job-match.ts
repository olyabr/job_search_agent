export type CareerProfile = {
  profileName: string;
  targetRoles: string;
  skills: string;
  preferredLocations: string;
  industryKeywords: string;
  seniorityKeywords: string;
  avoidKeywords: string;
  remoteOkay: boolean;
  minimumMatch: number;
};

export type EmailJobInput = {
  id: string;
  subject: string;
  from: string;
  snippet: string;
  date?: string;
};

export type JobMatch = {
  id: string;
  title: string;
  company: string;
  location: string;
  source: string;
  score: number;
  reasons: string[];
  snippet: string;
  date?: string;
  emailUrl: string;
};

function splitTerms(value = "") {
  return value
    .split(/[\n,;]+/)
    .map((term) => term.trim())
    .filter(Boolean);
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9+#. ]/g, " ").replace(/\s+/g, " ").trim();
}

function inferSource(from: string) {
  const text = from.toLowerCase();
  if (text.includes("indeed")) return "Indeed";
  if (text.includes("linkedin")) return "LinkedIn";
  if (text.includes("rigzone")) return "Rigzone";
  if (text.includes("ziprecruiter")) return "ZipRecruiter";
  if (text.includes("glassdoor")) return "Glassdoor";
  return "Email alert";
}

function inferTitle(email: EmailJobInput) {
  const indeed = email.subject.match(/^\d+\s+new\s+(.+?)\s+jobs?\s+in\s+/i);
  if (indeed?.[1]) return indeed[1].trim();

  const linkedin = email.subject.match(/^(.+?):\s+.+?\s+hired near you/i);
  if (linkedin?.[1]) return linkedin[1].trim();

  const position = email.snippet.match(/position\s+(.+?)(?:\s+through\s+|\s+at\s+|\s+with\s+)/i);
  if (position?.[1]) return position[1].trim().replace(/[.:-]+$/, "");

  return email.subject
    .replace(/^job alert:?\s*/i, "")
    .replace(/\s*[-|]\s*[^-|]+$/, "")
    .trim();
}

function inferCompany(email: EmailJobInput) {
  const linkedin = email.subject.match(/^.+?:\s+(.+?)\s+hired near you/i);
  if (linkedin?.[1]) return linkedin[1].trim();

  const accepting = email.snippet.match(/\b([A-Z][A-Za-z0-9&.' -]{1,45}?)\s+is accepting online applications/i);
  if (accepting?.[1]) return accepting[1].trim();

  return inferSource(email.from);
}

function inferLocation(email: EmailJobInput) {
  const subjectLocation = email.subject.match(/\s+in\s+([^|]+)$/i);
  if (subjectLocation?.[1]) return subjectLocation[1].trim();

  const text = `${email.subject} ${email.snippet}`;
  if (/\bremote\b/i.test(text)) return "Remote";
  return "Not specified";
}

function titleScore(title: string, targetRoles: string[]) {
  const titleNorm = normalize(title);
  let best = 0;

  for (const role of targetRoles) {
    const roleNorm = normalize(role);
    if (!roleNorm) continue;
    if (titleNorm.includes(roleNorm) || roleNorm.includes(titleNorm)) {
      best = Math.max(best, 40);
      continue;
    }

    const roleTokens = new Set(roleNorm.split(" ").filter((token) => token.length > 2));
    const titleTokens = new Set(titleNorm.split(" ").filter((token) => token.length > 2));
    if (!roleTokens.size) continue;
    const overlap = [...roleTokens].filter((token) => titleTokens.has(token)).length / roleTokens.size;
    best = Math.max(best, Math.round(overlap * 34));
  }

  return best;
}

export function rankJobs(emails: EmailJobInput[], profile: CareerProfile) {
  const targets = splitTerms(profile.targetRoles);
  const skills = splitTerms(profile.skills);
  const locations = splitTerms(profile.preferredLocations);
  const industries = splitTerms(profile.industryKeywords);
  const seniority = splitTerms(profile.seniorityKeywords);
  const avoid = splitTerms(profile.avoidKeywords);
  const hasPositiveCriteria =
    targets.length + skills.length + locations.length + industries.length + seniority.length > 0;

  const jobs = emails.map((email): JobMatch => {
    const title = inferTitle(email);
    const company = inferCompany(email);
    const location = inferLocation(email);
    const combined = normalize(`${title} ${company} ${location} ${email.subject} ${email.snippet}`);
    const reasons: string[] = [];

    let score = 12;
    const rolePoints = titleScore(title, targets);
    score += rolePoints;
    if (rolePoints >= 30) reasons.push("Strong title match");
    else if (rolePoints >= 16) reasons.push("Related target role");

    const matchedSkills = skills.filter((skill) => combined.includes(normalize(skill)));
    const skillPoints = Math.min(28, matchedSkills.length * 6);
    score += skillPoints;
    if (matchedSkills.length) {
      reasons.push(`Matches skills: ${matchedSkills.slice(0, 4).join(", ")}`);
    }

    const matchedLocation = locations.find((item) => combined.includes(normalize(item)));
    if (matchedLocation) {
      score += 10;
      reasons.push(`Preferred location: ${matchedLocation}`);
    } else if (profile.remoteOkay && combined.includes("remote")) {
      score += 10;
      reasons.push("Remote-friendly");
    }

    const matchedIndustries = industries.filter((item) => combined.includes(normalize(item)));
    const industryPoints = Math.min(8, matchedIndustries.length * 4);
    score += industryPoints;
    if (matchedIndustries.length) {
      reasons.push(`Relevant domain: ${matchedIndustries.slice(0, 2).join(", ")}`);
    }

    const matchedSeniority = seniority.find((item) => combined.includes(normalize(item)));
    if (matchedSeniority) {
      score += 7;
      reasons.push(`Seniority fit: ${matchedSeniority}`);
    }

    const matchedAvoid = avoid.filter((item) => combined.includes(normalize(item)));
    if (matchedAvoid.length) {
      score -= Math.min(30, matchedAvoid.length * 15);
      reasons.push(`Caution: ${matchedAvoid.slice(0, 2).join(", ")}`);
    }

    return {
      id: email.id,
      title,
      company,
      location,
      source: inferSource(email.from),
      score: Math.max(0, Math.min(100, score)),
      reasons: reasons.length ? reasons : ["Found in a job-related email"],
      snippet: email.snippet,
      date: email.date,
      emailUrl: `https://mail.google.com/mail/u/0/#all/${email.id}`,
    };
  });

  const deduped = new Map<string, JobMatch>();
  for (const job of jobs) {
    const key = normalize(`${job.title}|${job.company}|${job.location}`);
    const existing = deduped.get(key);
    if (!existing || job.score > existing.score) deduped.set(key, job);
  }

  const minimumScore = hasPositiveCriteria ? (profile.minimumMatch || 0) : 0;

  return [...deduped.values()]
    .filter((job) => job.score >= minimumScore)
    .sort((a, b) => b.score - a.score);
}
