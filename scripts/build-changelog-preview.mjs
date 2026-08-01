import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const defaultChangelogPath = resolve(rootDir, "CHANGELOG.md");
const defaultPreviewPath = resolve(rootDir, "preview", "changelog.html");

const RELEASE_TAG_OVERRIDES = {
  "v0.0.1": "foundation",
  "v0.1.0": "feature",
  "v0.1.1": "refactor",
  "v0.2.0": "feature",
  "v0.2.1": "fix",
};

export async function syncChangelogPreview(options = {}) {
  const changelogPath = options.changelogPath ? resolve(options.changelogPath) : defaultChangelogPath;
  const outputPath = options.outputPath ? resolve(options.outputPath) : defaultPreviewPath;

  const [markdown, template] = await Promise.all([
    readFile(changelogPath, "utf-8"),
    readFile(outputPath, "utf-8"),
  ]);

  const releases = parseChangelogMarkdown(markdown);
  const html = applyChangelogData(template, releases);
  await writeFile(outputPath, html, "utf-8");

  return {
    changelogPath,
    outputPath,
    releases,
    html,
  };
}

export function parseChangelogMarkdown(markdown) {
  markdown = markdown.replace(/\r\n/g, "\n");
  const releases = [];
  const releasePattern = /^##\s+(v[^\s]+)\s+—\s+(\d{4}-\d{2}-\d{2})$/gm;
  const matches = [...markdown.matchAll(releasePattern)];

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const version = match[1];
    const date = match[2];
    const sectionStart = match.index + match[0].length;
    const sectionEnd = index + 1 < matches.length ? matches[index + 1].index : markdown.length;
    const section = markdown.slice(sectionStart, sectionEnd);

    const commits = parseCommitTable(section);
    const decisions = parseBoldBullets(section, "### Key Design Decisions");
    const changes = parseChangeBullets(section);

    releases.push({
      version,
      date,
      tag: inferReleaseTag(version),
      summary: summarizeRelease({ decisions, changes }),
      commits,
      decisions,
      changes,
    });
  }

  return releases;
}

export function applyChangelogData(template, releases) {
  if (!releases.length) {
    throw new Error("Cannot generate preview changelog without releases");
  }

  const latest = releases[0];
  const totals = releases.reduce((acc, release) => acc + release.commits.length, 0);
  const currentReleaseCaption = `${latest.commits.length} commits tracked in ${latest.version} from CHANGELOG.md.`;
  const serializedReleases = JSON.stringify(releases, null, 2);

  return template
    .replace(
      /(<span class="n" id="stat-commits">)([^<]+)(<\/span> commits)/,
      `$1${totals}$3`,
    )
    .replace(
      /(<span class="n" id="stat-versions">)([^<]+)(<\/span> versions)/,
      `$1${releases.length}$3`,
    )
    .replace(
      /(<span class="n" id="stat-latest">)([^<]+)(<\/span> latest)/,
      `$1${latest.date}$3`,
    )
    .replace(
      /(<strong class="summary-value">)([^<]+)(<\/strong>\s*<div class="summary-caption">)([^<]+)(<\/div>)/,
      `$1${latest.version}$3${escapeAttribute(currentReleaseCaption)}$5`,
    )
    .replace(
      /(<footer class="footer">memoire changelog - [^<]* through )([^<]+)(<\/footer>)/,
      `$1${latest.version}$3`,
    )
    .replace(
      /const releases = \[[\s\S]*?\];\n\nconst rail =/,
      `const releases = ${serializedReleases};\n\nconst rail =`,
    )
    .replace(
      /row\.innerHTML = `\<strong>[^`]+<\/strong><span>\$\{item\}<\/span>`;/,
      "row.innerHTML = `<strong>${releases[0].version}</strong><span>${item}</span>`;",
    );
}

function parseCommitTable(section) {
  const table = extractSection(section, "### Commits");
  const commits = [];

  for (const line of table.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("| `")) {
      continue;
    }

    const match = trimmed.match(/^\|\s*`([^`]+)`\s*\|\s*(.+?)\s*\|$/);
    if (!match) {
      continue;
    }
    commits.push([match[1], normalizeMarkdownText(match[2])]);
  }

  return commits;
}

function parseBoldBullets(section, heading) {
  const block = extractSection(section, heading);
  const items = [];

  for (const line of block.split("\n")) {
    const trimmed = line.trim();
    const match = trimmed.match(/^- \*\*(.+?)\*\* — (.+)$/);
    if (!match) {
      continue;
    }
    items.push([normalizeMarkdownText(match[1]), normalizeMarkdownText(match[2])]);
  }

  return items;
}

function parseChangeBullets(section) {
  const items = [];

  for (const subsection of splitSubsections(section)) {
    if (subsection.heading === "Commits" || subsection.heading === "Key Design Decisions") {
      continue;
    }

    for (const line of subsection.body.split("\n")) {
      const trimmed = line.trim();
      const match = trimmed.match(/^- (.+)$/);
      if (!match) {
        continue;
      }
      items.push(normalizeMarkdownText(match[1]));
    }
  }

  return items;
}

function extractSection(section, heading) {
  const pattern = new RegExp(`${escapeRegex(heading)}\\n([\\s\\S]*?)(?=\\n### |\\n## |$)`);
  const match = section.match(pattern);
  return match ? match[1].trim() : "";
}

function splitSubsections(section) {
  const headingPattern = /^###\s+(.+)$/gm;
  const matches = [...section.matchAll(headingPattern)];
  const subsections = [];

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const heading = match[1].trim();
    const bodyStart = match.index + match[0].length;
    const bodyEnd = index + 1 < matches.length ? matches[index + 1].index : section.length;
    const body = section.slice(bodyStart, bodyEnd).trim();
    subsections.push({ heading, body });
  }

  return subsections;
}

function summarizeRelease(release) {
  const summaryParts = release.changes
    .slice(0, 3)
    .map((item) => item.replace(/\.$/, ""));

  if (summaryParts.length === 0 && release.decisions.length > 0) {
    return release.decisions[0][1];
  }

  if (summaryParts.length === 0) {
    return "Product changes captured in CHANGELOG.md.";
  }

  if (summaryParts.length === 1) {
    return `${summaryParts[0]}.`;
  }

  return `${summaryParts.join("; ")}.`;
}

function inferReleaseTag(version) {
  if (RELEASE_TAG_OVERRIDES[version]) {
    return RELEASE_TAG_OVERRIDES[version];
  }

  if (version === "v0.0.1") {
    return "foundation";
  }

  const [, major = "0", minor = "0", patch = "0"] = version.match(/^v(\d+)\.(\d+)\.(\d+)$/) || [];
  if (major === "0" && minor === "0" && patch === "1") {
    return "foundation";
  }
  return Number(patch) > 0 ? "fix" : "feature";
}

function normalizeMarkdownText(value) {
  return value
    .replace(/`([^`]+)`/g, "$1")
    .replace(/&mdash;/g, "—")
    .trim();
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeAttribute(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await syncChangelogPreview();
}
