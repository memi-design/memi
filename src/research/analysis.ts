export type ResearchSentiment = "positive" | "negative" | "neutral" | "mixed";

const POSITIVE_WORDS = new Set([
  "love", "great", "amazing", "excellent", "awesome", "perfect", "easy", "helpful",
  "enjoy", "fantastic", "wonderful", "good", "nice", "like", "prefer", "happy",
  "convenient", "intuitive", "smooth", "fast", "reliable", "clear", "simple",
  "beautiful", "impressive", "satisfied", "delighted", "appreciate", "excited",
]);

const NEGATIVE_WORDS = new Set([
  "hate", "terrible", "awful", "bad", "horrible", "difficult", "confusing",
  "frustrating", "annoying", "slow", "broken", "ugly", "complicated", "hard",
  "painful", "impossible", "worst", "disappointed", "angry", "stuck", "lost",
  "bug", "crash", "error", "fail", "missing", "unclear", "overwhelming",
  "clunky", "unusable", "tedious", "inconsistent", "unreliable",
]);

const CATEGORY_PATTERNS: [RegExp, string][] = [
  [/\b(frustrat|annoy|difficult|hard to|struggle|can't find|doesn't work|broken|pain point|pain|hate|worst|blocked|slow)\b/i, "pain-point"],
  [/\b(want|wish|hope|would be nice|need|looking for|trying to|goal|aim)\b/i, "goal"],
  [/\b(usually|always|every time|habit|routine|tend to|normally|typically|my process)\b/i, "behavior"],
  [/\b(need|require|must have|essential|critical|important|necessary)\b/i, "need"],
  [/\b(think|feel|believe|opinion|prefer|rather|personally)\b/i, "opinion"],
  [/\b(feature|add|should have|would love|request|suggest|idea|could you)\b/i, "feature-request"],
  [/\b(workaround|hack|instead i|way around|alternative|trick)\b/i, "workaround"],
  [/\b(best practice|recommend|guideline|standard)\b/i, "best-practice"],
  [/\b(market|adoption|revenue|growth|benchmark|trend)\b/i, "market-data"],
  [/\b(api|performance|latency|browser|compatibility|integration)\b/i, "technical-constraint"],
  [/\b(compliance|regulation|gdpr|wcag|ada|hipaa|legal)\b/i, "regulatory"],
];

const GENERIC_TAGS = new Set([
  "qualitative",
  "quantitative",
  "interview",
  "survey",
  "web-research",
  "web",
  "stickies",
  "raw-note",
  "context",
  "positive",
  "negative",
  "neutral",
  "mixed",
  "excel",
  "csv",
  "transcript",
  "figjam",
]);

const STOPWORDS = new Set([
  "about", "after", "again", "against", "almost", "also", "although", "always", "among",
  "another", "because", "before", "being", "between", "could", "every", "first", "found",
  "from", "have", "having", "into", "like", "more", "most", "much", "need", "needs", "only",
  "other", "over", "really", "said", "same", "should", "some", "than", "that", "their",
  "them", "then", "there", "these", "they", "thing", "this", "those", "through", "very",
  "want", "were", "what", "when", "where", "which", "while", "with", "would", "your",
  "user", "users", "customer", "customers", "participant", "participants", "respondent",
  "respondents", "people", "person", "survey", "interview", "feedback", "comment", "comments",
]);

const ENTITY_PATTERNS = [
  /\b(?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g,
  /\b(?:React|Vue|Angular|Svelte|Next\.?js|Tailwind|Figma|Linear|Supabase|Vercel|Notion|Slack)\b/g,
  /\b(?:WCAG|ARIA|GDPR|ADA|HIPAA|SOC\s*2)\b/g,
  /\b\d+(?:\.\d+)?%/g,
  /\$[\d,.]+[BMK]?\b/g,
];

export function detectResearchSentiment(text: string): ResearchSentiment {
  const words = text.toLowerCase().split(/\W+/);
  let positive = 0;
  let negative = 0;

  for (const word of words) {
    if (POSITIVE_WORDS.has(word)) positive++;
    if (NEGATIVE_WORDS.has(word)) negative++;
  }

  if (positive > 0 && negative > 0) return "mixed";
  if (positive > negative) return "positive";
  if (negative > positive) return "negative";
  return "neutral";
}

export function inferResearchCategory(text: string, tags: string[] = []): string {
  const existing = tags.find((tag) => !GENERIC_TAGS.has(tag.toLowerCase()) && CATEGORY_PATTERNS.some(([, category]) => category === tag));
  if (existing) return existing;

  for (const [pattern, category] of CATEGORY_PATTERNS) {
    if (pattern.test(text)) return category;
  }

  return "general";
}

export function extractResearchEntities(text: string): string[] {
  const entities = new Set<string>();

  for (const pattern of ENTITY_PATTERNS) {
    const matches = text.match(pattern);
    if (!matches) continue;
    for (const match of matches) {
      const trimmed = match.trim();
      if (trimmed.length > 2 && trimmed.length < 60) {
        entities.add(trimmed);
      }
    }
  }

  return Array.from(entities);
}

export function extractResearchSignals(
  text: string,
  tags: string[] = [],
  entities: string[] = [],
  limit = 5,
): string[] {
  const ranked = new Map<string, number>();

  for (const tag of tags) {
    const normalized = normalizeResearchSignal(tag);
    if (!normalized) continue;
    ranked.set(normalized, (ranked.get(normalized) ?? 0) + 6);
  }

  for (const entity of entities) {
    const normalized = normalizeResearchSignal(entity);
    if (!normalized) continue;
    ranked.set(normalized, (ranked.get(normalized) ?? 0) + 5);
  }

  const cleaned = stripFindingPrefix(text).toLowerCase();
  const words = cleaned
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .map(stemSignal)
    .filter((word) => word.length >= 4 && !STOPWORDS.has(word));

  for (let i = 0; i < words.length; i++) {
    const word = normalizeResearchSignal(words[i]);
    if (!word) continue;
    ranked.set(word, (ranked.get(word) ?? 0) + 1);

    if (i < words.length - 1) {
      const bigram = normalizeResearchSignal(`${words[i]} ${words[i + 1]}`);
      if (bigram) ranked.set(bigram, (ranked.get(bigram) ?? 0) + 2);
    }
  }

  return Array.from(ranked.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([signal]) => signal);
}

export function normalizeResearchSignal(input: string): string {
  const normalized = input
    .toLowerCase()
    .trim()
    .replace(/[`"'’]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .split(" ")
    .map(stemSignal)
    .join(" ")
    .trim();

  if (!normalized || GENERIC_TAGS.has(normalized) || STOPWORDS.has(normalized)) {
    return "";
  }

  return normalized;
}

export function formatResearchSignal(signal: string): string {
  return signal
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function stripFindingPrefix(finding: string): string {
  return finding.replace(/^(Pain point|User goal|Behavior pattern|User need|User opinion|Feature request|Workaround|Theme|Survey feedback|Web finding|Sentiment analysis):\s*/i, "").trim();
}

function stemSignal(input: string): string {
  if (input.endsWith("ies") && input.length > 4) return input.slice(0, -3) + "y";
  if (input.endsWith("ing") && input.length > 5) return input.slice(0, -3);
  if (input.endsWith("ed") && input.length > 4) return input.slice(0, -2);
  if (input.endsWith("es") && input.length > 4) return input.slice(0, -2);
  if (input.endsWith("s") && input.length > 4) return input.slice(0, -1);
  return input;
}
