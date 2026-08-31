import { NextResponse } from "next/server";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";

export const runtime = "nodejs";

const TITLE_WORDS = [
  "engineer", "developer", "scientist", "analyst", "manager", "director", "designer", "architect",
  "consultant", "specialist", "coordinator", "administrator", "researcher", "geologist", "geophysicist",
  "accountant", "attorney", "nurse", "physician", "therapist", "pharmacist", "teacher", "professor",
  "instructor", "product", "marketing", "sales", "operations", "technician", "recruiter", "writer",
];

const SENIORITY_WORDS = [
  "intern", "junior", "entry level", "associate", "mid-level", "senior", "lead", "staff", "principal",
  "manager", "director", "vice president", "vp", "head", "chief",
];

const INDUSTRY_WORDS = [
  "technology", "software", "healthcare", "finance", "banking", "insurance", "energy", "oil", "gas",
  "geophysics", "geology", "education", "retail", "manufacturing", "consulting", "government", "aerospace",
  "automotive", "pharmaceutical", "biotech", "telecommunications", "media", "marketing", "real estate",
  "construction", "logistics", "transportation", "hospitality", "cybersecurity", "artificial intelligence",
  "machine learning", "data science",
];

const SKILL_TERMS = [
  "python", "java", "javascript", "typescript", "react", "next.js", "node.js", "sql", "excel", "tableau",
  "power bi", "aws", "azure", "gcp", "docker", "kubernetes", "pytorch", "tensorflow", "scikit-learn",
  "machine learning", "deep learning", "data science", "project management", "product management", "agile",
  "scrum", "jira", "salesforce", "sap", "autocad", "solidworks", "matlab", "r", "c++", "c#", "git",
  "leadership", "budgeting", "forecasting", "financial modeling", "patient care", "clinical research",
  "customer service", "business development", "marketing", "seo", "content strategy", "recruiting",
  "seismic interpretation", "geophysics", "reservoir characterization", "signal processing", "computer vision",
  "natural language processing", "nlp", "data engineering", "data pipelines", "statistics", "analytics",
];

function cleanText(text: string) {
  return text
    .replace(/\r/g, "")
    .replace(/[\t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function unique(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLowerCase().trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function inferTitles(text: string) {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  return unique(
    lines.filter((line) => {
      const lower = line.toLowerCase();
      if (line.length < 3 || line.length > 90) return false;
      if (/^[-•●▪]/.test(line) || /@|https?:\/\//i.test(line)) return false;
      if (/\b(19|20)\d{2}\b/.test(line) && line.length > 55) return false;
      return TITLE_WORDS.some((word) => lower.includes(word));
    }),
  ).slice(0, 4);
}

function inferSkills(text: string) {
  const lower = text.toLowerCase();
  const explicit = SKILL_TERMS.filter((skill) => lower.includes(skill.toLowerCase()));

  const sectionMatch = text.match(/(?:^|\n)(?:skills|technical skills|core competencies|expertise)\s*[:\n]([\s\S]{0,900}?)(?=\n[A-Z][A-Za-z &/]{2,35}:?\s*\n|\n\n[A-Z][A-Z &/]{3,}|$)/i);
  const sectionTerms = sectionMatch?.[1]
    ? sectionMatch[1]
        .split(/[\n,;|•●▪]+/)
        .map((item) => item.replace(/^[-–—]\s*/, "").trim())
        .filter((item) => item.length >= 2 && item.length <= 45)
    : [];

  return unique([...sectionTerms, ...explicit]).slice(0, 24);
}

function inferSeniority(text: string, titles: string[]) {
  const lower = `${titles.join(" ")} ${text.slice(0, 2500)}`.toLowerCase();
  return unique(SENIORITY_WORDS.filter((word) => lower.includes(word))).slice(0, 4);
}

function inferIndustries(text: string) {
  const lower = text.toLowerCase();
  return unique(INDUSTRY_WORDS.filter((word) => lower.includes(word))).slice(0, 6);
}

async function extractText(file: File) {
  const name = file.name.toLowerCase();
  const bytes = new Uint8Array(await file.arrayBuffer());

  if (name.endsWith(".pdf") || file.type === "application/pdf") {
    const parser = new PDFParse({ data: bytes });
    try {
      const result = await parser.getText();
      return result.text;
    } finally {
      await parser.destroy();
    }
  }

  if (name.endsWith(".docx") || file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    return result.value;
  }

  if (name.endsWith(".txt") || name.endsWith(".md") || file.type.startsWith("text/")) {
    return new TextDecoder().decode(bytes);
  }

  throw new Error("Please upload a PDF, DOCX, TXT, or MD resume.");
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("resume");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Resume file is required." }, { status: 400 });
    }

    if (file.size > 7 * 1024 * 1024) {
      return NextResponse.json({ error: "Resume must be smaller than 7 MB." }, { status: 400 });
    }

    const text = cleanText(await extractText(file));
    if (text.length < 80) {
      return NextResponse.json({ error: "Not enough readable text was found in that resume." }, { status: 400 });
    }

    const titles = inferTitles(text);
    const skills = inferSkills(text);
    const seniority = inferSeniority(text, titles);
    const industries = inferIndustries(text);

    return NextResponse.json({
      fileName: file.name,
      extractedCharacters: text.length,
      profile: {
        profileName: file.name.replace(/\.(pdf|docx|txt|md)$/i, "") || "Resume profile",
        targetRoles: titles.join("\n"),
        skills: skills.join(", "),
        preferredLocations: "",
        industryKeywords: industries.join(", "),
        seniorityKeywords: seniority.join(", "),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not read resume." },
      { status: 500 },
    );
  }
}
