import fs from "fs";
import path from "path";

const root = process.cwd();
const rootDocs = [
  "README.md",
  "CHECKLIST.md",
  "PLAN.md",
  "TODO.md",
  "OBJECTIVES.md",
  "FOUNDATIONS.md",
  "AGENTS.md"
];
const allowedExampleFiles = new Set();
const ecosystemRepos = [
  "mesh-ecology",
  "mesh-v0-2",
  "mesh-ecology-packs",
  "mindful",
  "Virtualia",
  "interactive-fiction-concern-surface",
  "mindful-ops-lab"
];

const escapedRepos = ecosystemRepos.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
const absoluteWorkspacePattern = /\/home\/zevilz\/WebstormProjects\//g;
const remotePattern = new RegExp(
  String.raw`(?:git@github\.com:|https:\/\/github\.com\/)(?:[^/\s]+\/)?(?:${escapedRepos})(?:\.git)?`,
  "gi"
);
const relativeLinkPattern = new RegExp(
  String.raw`\]\((?:\.\.\/(?:${escapedRepos})\/|\/home\/zevilz\/WebstormProjects\/(?:${escapedRepos})\/)`,
  "g"
);

const files = [
  ...rootDocs
    .map((name) => path.join(root, name))
    .filter((file) => fs.existsSync(file)),
  ...collectMarkdown(path.join(root, "docs"))
];

const failures = [];

for (const file of files) {
  const rel = path.relative(root, file);
  const text = fs.readFileSync(file, "utf8");
  const content = stripFencedCodeBlocks(text);
  const allowExamples = allowedExampleFiles.has(rel);

  if (!allowExamples) {
    pushMatches(failures, rel, content, absoluteWorkspacePattern, "hardcoded workspace path");
    pushMatches(failures, rel, content, remotePattern, "ecosystem GitHub remote");
    pushMatches(failures, rel, content, relativeLinkPattern, "cross-repo deep markdown link");
  }
}

if (failures.length > 0) {
  console.error("docs:check failed");
  for (const failure of failures) {
    console.error(`- ${failure.file}:${failure.line} ${failure.kind}`);
    console.error(`  ${failure.text}`);
  }
  process.exit(1);
}

console.log(`docs:check passed (${files.length} files checked)`);

function collectMarkdown(dir) {
  if (!fs.existsSync(dir)) return [];
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectMarkdown(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md")) {
      results.push(fullPath);
    }
  }
  return results;
}

function stripFencedCodeBlocks(text) {
  const lines = text.split("\n");
  const kept = [];
  let inFence = false;
  for (const line of lines) {
    if (/^```/.test(line.trim())) {
      inFence = !inFence;
      kept.push("");
      continue;
    }
    kept.push(inFence ? "" : line);
  }
  return kept.join("\n");
}

function pushMatches(failuresList, rel, content, pattern, kind) {
  const lines = content.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    pattern.lastIndex = 0;
    if (!pattern.test(lines[index])) continue;
    failuresList.push({
      file: rel,
      line: index + 1,
      kind,
      text: lines[index].trim()
    });
  }
}
