import fs from "fs";
import path from "path";

const root = process.cwd();
const allowedExampleFiles = new Set();
const ignoredDirs = new Set([
  ".codex",
  ".git",
  ".next",
  ".nuxt",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
  "vendor"
]);
const ecosystemRepos = [
  "mesh-ecology",
  "mesh-v0-2",
  "mesh-ecology-packs",
  "mindful",
  "Virtualia",
  "interactive-fiction-concern-surface",
  "mindful-ops-lab"
];
const allowedRemoteRepos = new Set([
  "mesh-ecology"
]);

const blockedRemoteRepos = ecosystemRepos.filter((name) => !allowedRemoteRepos.has(name));
const escapedRepos = ecosystemRepos.map(escapeRegex).join("|");
const escapedBlockedRemoteRepos = blockedRemoteRepos.map(escapeRegex).join("|");
const absolutePathPatterns = [
  /(?:^|[\s`"'(])(?:\/Users\/[^/\s`"'()]+|\/home\/[^/\s`"'()]+)(?:\/[^\s`"'()]+)+/g,
  /(?:^|[\s`"'(])[A-Za-z]:\\Users\\[^\\\s`"'()]+(?:\\[^\s`"'()]+)+/g
];
const remotePattern = escapedBlockedRemoteRepos.length > 0
  ? new RegExp(
      String.raw`(?:git@github\.com:|https:\/\/github\.com\/)(?:[^/\s]+\/)(?:${escapedBlockedRemoteRepos})(?:\.git)?(?:$|[/?#\s)])`,
      "gi"
    )
  : null;
const relativeRepoPathPattern = new RegExp(
  String.raw`(?:^|[\s` + "`" + String.raw`"'(])(?:\.\.\/(?:${escapedRepos})\/|\.\.\\(?:${escapedRepos})\\)`,
  "g"
);

const files = collectMarkdown(root);

const failures = [];

for (const file of files) {
  const rel = path.relative(root, file);
  const text = fs.readFileSync(file, "utf8");
  const allowExamples = allowedExampleFiles.has(rel);

  if (!allowExamples) {
    for (const pattern of absolutePathPatterns) {
      pushMatches(failures, rel, text, pattern, "hardcoded local absolute path");
    }
    pushMatches(failures, rel, text, remotePattern, "ecosystem GitHub remote");
    pushMatches(failures, rel, text, relativeRepoPathPattern, "cross-repo deep relative path");
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
    if (ignoredDirs.has(entry.name)) continue;
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

function pushMatches(failuresList, rel, content, pattern, kind) {
  if (!pattern) return;
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

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
