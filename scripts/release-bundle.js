#!/usr/bin/env node

import { lstat, mkdir, readdir } from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { execSync, spawnSync } from 'child_process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')

const ROOT_ALLOWLIST = [
  'src',
  'packages',
  'deploy',
  'docs/runbooks/hetzner-deploy.md',
  'docs/v0-locked.md',
  'docs/protocol.md',
  'scripts/audit-hetzner-packages.js',
  'scripts/audit-hetzner-packages.expected.json',
  'scripts/smoke-hetzner-packages.js',
  'scripts/release-bundle.js',
  'package.json'
]

const LOCKFILES = [
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lockb'
]

const STATIC_EXCLUDED_DIRS = new Set(['.git', 'node_modules', 'dist', 'tmp', 'logs'])
const STATIC_EXCLUDED_FILES = new Set(['.DS_Store'])
const SECRET_EXTENSIONS = new Set(['.key', '.pem', '.p12', '.pfx'])

function isCorestoreDataDir(segment) {
  return /^corestore([._-].*)?$/.test(segment) || segment === '.corestore'
}

function shouldExcludePath(relPath) {
  const normalized = relPath.replace(/\\/g, '/').replace(/\/+$/, '')
  const segments = normalized.split('/').filter(Boolean)
  const base = segments[segments.length - 1] ?? ''

  if (segments.some((segment) => STATIC_EXCLUDED_DIRS.has(segment))) return true
  if (segments.some((segment) => isCorestoreDataDir(segment))) return true
  if (STATIC_EXCLUDED_FILES.has(base)) return true
  if (base === '.env' || base.startsWith('.env.')) return true
  if (SECRET_EXTENSIONS.has(path.extname(base).toLowerCase())) return true

  return false
}

async function pathExists(relPath) {
  try {
    await lstat(path.join(repoRoot, relPath))
    return true
  } catch {
    return false
  }
}

async function collectFiles(relPath, output) {
  const abs = path.join(repoRoot, relPath)
  const stats = await lstat(abs)

  if (shouldExcludePath(relPath)) return

  if (stats.isSymbolicLink() || stats.isFile()) {
    output.push(relPath.replace(/\\/g, '/'))
    return
  }

  if (!stats.isDirectory()) return

  const entries = await readdir(abs, { withFileTypes: true })
  entries.sort((a, b) => a.name.localeCompare(b.name))

  for (const entry of entries) {
    const childRel = path.posix.join(relPath.replace(/\\/g, '/'), entry.name)
    if (shouldExcludePath(childRel)) continue
    await collectFiles(childRel, output)
  }
}

function getRevisionTag() {
  try {
    const sha = execSync('git rev-parse --short=12 HEAD', {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
    if (sha) return sha
  } catch {
    // fall through to timestamp
  }

  const now = new Date()
  const parts = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
    String(now.getUTCHours()).padStart(2, '0'),
    String(now.getUTCMinutes()).padStart(2, '0'),
    String(now.getUTCSeconds()).padStart(2, '0')
  ]
  return `ts${parts.join('')}`
}

async function main() {
  const relFiles = []
  const includeSet = new Set(ROOT_ALLOWLIST)

  for (const lockfile of LOCKFILES) {
    if (await pathExists(lockfile)) includeSet.add(lockfile)
  }

  for (const relPath of includeSet) {
    if (!(await pathExists(relPath))) continue
    await collectFiles(relPath, relFiles)
  }

  const dedupedSortedFiles = [...new Set(relFiles)].sort((a, b) => a.localeCompare(b))
  if (dedupedSortedFiles.length === 0) {
    throw new Error('No files selected for bundle; check allowlist paths.')
  }

  const distDir = path.join(repoRoot, 'dist')
  await mkdir(distDir, { recursive: true })

  const revisionTag = getRevisionTag()
  const releaseDirName = `mesh-v0-2-${revisionTag}`
  const archiveName = `${releaseDirName}.tar.gz`
  const archivePath = path.join(distDir, archiveName)

  const tarArgs = [
    '--create',
    '--gzip',
    '--file',
    archivePath,
    '--directory',
    repoRoot,
    '--sort=name',
    '--mtime=UTC 1970-01-01',
    '--owner=0',
    '--group=0',
    '--numeric-owner',
    '--pax-option=exthdr.name=%d/PaxHeaders/%f,delete=atime,delete=ctime',
    '--transform',
    `s|^|${releaseDirName}/|`,
    '--files-from=-'
  ]

  const tarResult = spawnSync('tar', tarArgs, {
    input: `${dedupedSortedFiles.join('\n')}\n`,
    stdio: ['pipe', 'inherit', 'inherit']
  })

  if (tarResult.status !== 0) {
    throw new Error(`tar command failed with exit code ${tarResult.status ?? 'unknown'}`)
  }

  console.log(`Created bundle: ${path.relative(repoRoot, archivePath)}`)
  console.log(`Release directory in archive: ${releaseDirName}/`)
  console.log(`Included files: ${dedupedSortedFiles.length}`)
}

main().catch((err) => {
  console.error(`[release-bundle] ${err.message}`)
  process.exit(1)
})
