#!/usr/bin/env node

import { lstat } from "node:fs/promises";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_SOURCE_REPOSITORY = "https://github.com/memi-design/memi";
const DEFAULT_INSTALL_REPOSITORY = "memi-design/memi";
const DEFAULT_VERSION = "0.0.0";
const OPTIONAL_MEMI_MARKER = "## Optional Memi enhancements";

export const FOCUSED_SKILLS = Object.freeze([
  {
    name: "audit-frontend-design",
    title: "Audit Frontend Design",
    description: "Evidence-backed frontend design review for accessibility, hierarchy, tokens, states, and responsive behavior.",
    enhancement: "Use Memi's deterministic `diagnose`, `ux audit`, and `craft audit` commands when they are available; equivalent local checks keep this skill useful without Memi.",
  },
  {
    name: "enforce-design-ci",
    title: "Enforce Design CI",
    description: "Deterministic pull-request checks for accessibility, design tokens, component structure, responsive behavior, and UI states.",
    enhancement: "Use Memi's `init` and `ci` commands to generate policy, baseline, SARIF, and report artifacts when Memi is available; the quality gate can also use equivalent repository tooling.",
  },
  {
    name: "remember-design-system",
    title: "Remember The Design System",
    description: "A repository-specific preflight brief for tokens, components, routes, conventions, and verification commands before interface work.",
    enhancement: "Use Memi's `agent brief` and `tokens` commands for deterministic repository evidence when Memi is available; the discovery and handoff workflow remains valid with local tools alone.",
  },
].sort((left, right) => left.name.localeCompare(right.name)));

const FOCUSED_SKILL_BY_NAME = new Map(FOCUSED_SKILLS.map((skill) => [skill.name, skill]));

export async function exportFocusedSkills(options = {}) {
  const sourceRoot = resolve(options.sourceRoot ?? join(SCRIPT_ROOT, "skills"));
  const outputRoot = resolve(options.outputRoot ?? join(SCRIPT_ROOT, "dist", "focused-skills"));
  const selectedNames = normalizeSkillNames(options.skills);
  const sourceRepository = normalizeSourceRepository(options.sourceRepository ?? DEFAULT_SOURCE_REPOSITORY);
  const installRepository = options.installRepository ?? DEFAULT_INSTALL_REPOSITORY;
  const version = options.version ?? await readPackageVersion();
  const includeMemiEnhancement = options.includeMemiEnhancement === true;
  const license = normalizeNewlines(await readRequiredFile(join(SCRIPT_ROOT, "LICENSE")));

  validateRepositoryValue(installRepository, "installRepository");
  validateVersion(version);
  assertOutputDoesNotContainSource(sourceRoot, outputRoot);
  await assertOutputIsNotSymlink(outputRoot);

  const selected = selectedNames.map((name) => {
    const skill = FOCUSED_SKILL_BY_NAME.get(name);
    if (!skill) throw new Error(`Unknown focused skill "${name}". Use: ${FOCUSED_SKILLS.map((entry) => entry.name).join(", ")}`);
    return skill;
  });

  const payloads = await Promise.all(selected.map(async (skill) => {
    const sourcePath = join(sourceRoot, skill.name, "SKILL.md");
    const markdown = normalizeNewlines(await readRequiredFile(sourcePath));
    validateSkillMarkdown(markdown, skill.name, sourcePath);

    return {
      skill,
      sourcePath,
      files: buildExportFiles({
        skill,
        markdown,
        license,
        sourceRepository,
        installRepository,
        version,
        includeMemiEnhancement,
      }),
    };
  }));

  await mkdir(outputRoot, { recursive: true });
  for (const payload of payloads) {
    const destination = join(outputRoot, payload.skill.name);
    await rm(destination, { recursive: true, force: true });
    await mkdir(destination, { recursive: true });
    for (const [fileName, contents] of Object.entries(payload.files)) {
      await writeFile(join(destination, fileName), contents, "utf8");
    }
  }

  return {
    outputRoot,
    skills: payloads.map(({ skill }) => skill.name),
    includeMemiEnhancement,
  };
}

export function parseArgs(argv) {
  const options = {
    skills: undefined,
    outputRoot: undefined,
    sourceRoot: undefined,
    sourceRepository: undefined,
    installRepository: undefined,
    version: undefined,
    includeMemiEnhancement: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") return { help: true };
    if (argument === "--include-memi-enhancement") {
      options.includeMemiEnhancement = true;
      continue;
    }
    if (argument === "--no-memi-enhancement") {
      options.includeMemiEnhancement = false;
      continue;
    }

    const [flag, inlineValue] = argument.split("=", 2);
    const value = inlineValue ?? argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);

    switch (flag) {
      case "--skills":
      case "--skill":
        options.skills = value.split(",").map((name) => name.trim()).filter(Boolean);
        break;
      case "--out-root":
        options.outputRoot = value;
        break;
      case "--source-root":
        options.sourceRoot = value;
        break;
      case "--source-repository":
        options.sourceRepository = value;
        break;
      case "--install-repository":
        options.installRepository = value;
        break;
      case "--version":
        options.version = value;
        break;
      default:
        throw new Error(`Unknown option "${argument}". Use --help for usage.`);
    }
  }

  return options;
}

function buildExportFiles({ skill, markdown, license, sourceRepository, installRepository, version, includeMemiEnhancement }) {
  const skillMarkdown = includeMemiEnhancement
    ? appendMemiEnhancement(markdown, skill.enhancement)
    : markdown;
  const sourcePath = `skills/${skill.name}/SKILL.md`;
  const packageJson = {
    name: `@memi-design/skill-${skill.name}`,
    version,
    private: true,
    description: skill.description,
    license: "MIT",
    repository: {
      type: "git",
      url: `${sourceRepository}.git`,
      directory: `skills/${skill.name}`,
    },
    files: ["SKILL.md", "README.md", "SOURCE.json", "LICENSE"],
  };
  const sourceJson = {
    schemaVersion: 1,
    skill: skill.name,
    sourceRepository,
    sourceRef: "main",
    sourcePath,
    sourceVersion: version,
    exportedBy: "scripts/export-focused-skills.mjs",
    memiEnhancementIncluded: includeMemiEnhancement,
  };

  return {
    "SKILL.md": skillMarkdown,
    "README.md": buildReadme(skill, installRepository, sourceRepository, includeMemiEnhancement),
    "SOURCE.json": `${JSON.stringify(sourceJson, null, 2)}\n`,
    "package.json": `${JSON.stringify(packageJson, null, 2)}\n`,
    "LICENSE": license,
  };
}

function buildReadme(skill, installRepository, sourceRepository, includeMemiEnhancement) {
  const enhancementNote = includeMemiEnhancement
    ? "This export includes an optional Memi enhancement appendix; the core workflow remains usable with equivalent local tools."
    : "This export contains the base skill only and does not add a Memi enhancement appendix.";

  return `# ${skill.name}

${skill.description}

This is a standalone Agent Skill export. Read [SKILL.md](./SKILL.md) when the skill's workflow applies.

## Install

\`\`\`bash
npx skills add ${installRepository} --skill ${skill.name}
\`\`\`

The source-of-record is [${sourceRepository}](https://github.com/${sourceRepository.replace(/^https:\/\/github\.com\//, "")}) at \`skills/${skill.name}/SKILL.md\`. See [SOURCE.json](./SOURCE.json) for machine-readable provenance.

${enhancementNote}
`;
}

function appendMemiEnhancement(markdown, enhancement) {
  if (markdown.includes(OPTIONAL_MEMI_MARKER)) return markdown;
  return `${markdown.trimEnd()}\n\n${OPTIONAL_MEMI_MARKER}\n\n${enhancement}\n`;
}

async function readRequiredFile(path) {
  const fileStat = await lstat(path).catch(() => null);
  if (!fileStat?.isFile() || fileStat.isSymbolicLink()) throw new Error(`Focused skill source must be a regular file: ${path}`);
  return readFile(path, "utf8");
}

async function assertOutputIsNotSymlink(outputRoot) {
  const outputStat = await lstat(outputRoot).catch(() => null);
  if (outputStat?.isSymbolicLink()) throw new Error(`Output root must not be a symbolic link: ${outputRoot}`);
}

function validateSkillMarkdown(markdown, skillName, sourcePath) {
  const frontmatter = markdown.match(/^---\n([\s\S]*?)\n---\n/);
  if (!frontmatter) throw new Error(`${sourcePath} must contain YAML frontmatter`);
  const name = frontmatter[1].match(/^name:\s*([^\n#]+?)\s*$/m)?.[1];
  const description = frontmatter[1].match(/^description:\s*([^\n#]+?)\s*$/m)?.[1];
  if (name !== skillName) throw new Error(`${sourcePath} frontmatter name must be ${skillName}`);
  if (!description) throw new Error(`${sourcePath} frontmatter description is required`);
  if (!markdown.slice(frontmatter[0].length).trim()) throw new Error(`${sourcePath} must contain a skill body`);
}

function normalizeSkillNames(names) {
  if (names === undefined) return FOCUSED_SKILLS.map((skill) => skill.name);
  if (!Array.isArray(names) || names.length === 0) throw new Error("At least one focused skill must be selected");
  const unique = [...new Set(names)];
  return unique.sort((left, right) => left.localeCompare(right));
}

async function readPackageVersion() {
  try {
    const packageJson = JSON.parse(await readFile(join(SCRIPT_ROOT, "package.json"), "utf8"));
    return packageJson.version ?? DEFAULT_VERSION;
  } catch {
    return DEFAULT_VERSION;
  }
}

function validateVersion(version) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid package version "${version}"`);
  }
}

function validateRepositoryValue(value, field) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) {
    throw new Error(`${field} must use the OWNER/REPOSITORY form`);
  }
}

function normalizeSourceRepository(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "github.com" || url.search || url.hash) throw new Error();
    const parts = url.pathname.replace(/\.git$/, "").split("/").filter(Boolean);
    if (parts.length !== 2 || parts.some((part) => !/^[A-Za-z0-9_.-]+$/.test(part))) throw new Error();
    return `https://github.com/${parts.join("/")}`;
  } catch {
    throw new Error("sourceRepository must be an HTTPS GitHub repository URL");
  }
}

function assertOutputDoesNotContainSource(sourceRoot, outputRoot) {
  const source = resolve(sourceRoot);
  const output = resolve(outputRoot);
  const sourceToOutput = relative(source, output);
  if (!sourceToOutput || (!sourceToOutput.startsWith(`..${sep}`) && sourceToOutput !== ".." && !sourceToOutput.startsWith("../"))) {
    throw new Error(`Output root must not be the source root or inside it: ${output}`);
  }
}

function normalizeNewlines(value) {
  return value.replace(/\r\n/g, "\n");
}

function usage() {
  return `Usage: node scripts/export-focused-skills.mjs [options]

Options:
  --out-root <path>                    Output root (default: dist/focused-skills)
  --source-root <path>                 Focused skill source root (default: skills)
  --skills <a,b,c>                     Export a subset (default: all focused skills)
  --source-repository <https-url>      Source provenance URL
  --install-repository <owner/repo>    Repository used in npx skills add
  --version <semver>                   Export package version
  --include-memi-enhancement           Append optional Memi guidance
  --no-memi-enhancement                Export the base SKILL.md unchanged
  --help                               Show this message`;
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
      return;
    }
    const result = await exportFocusedSkills(options);
    console.log(`Exported ${result.skills.length} focused skill${result.skills.length === 1 ? "" : "s"} to ${result.outputRoot}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
