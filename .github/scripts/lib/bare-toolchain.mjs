/**
 * Compare the bare toolchain pinned in .github/bare-toolchain/package-lock.json
 * with what npm publishes, and the tools on PATH with the lockfile.
 *
 * Only the packages that change what a build produces are watched. Their
 * per-platform packages are released in lockstep with them, and the remaining
 * entries are bare-make's own JavaScript dependencies.
 */

'use strict'

export const WATCHED = [
  'bare-make',
  'cmake-toolchains',
  'llvm-runtime',
  'cmake-runtime',
  'ninja-runtime',
  'nasm-runtime',
]

export const ISSUE_TITLE = 'bare toolchain update available'
export const ISSUE_LABEL = 'toolchain-drift'
const MARKER = 'bare-toolchain-drift'

export function lockedVersions(lockfile) {
  const packages = lockfile?.packages ?? {}
  const versions = {}
  for (const name of WATCHED) {
    const entry = packages[`node_modules/${name}`]
    if (!entry?.version) throw new Error(`${name} is missing from the bare toolchain lockfile`)
    versions[name] = entry.version
  }
  return versions
}

function parse(version) {
  const match = String(version).trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/)
  if (!match) return null
  return { parts: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4] ?? null }
}

/** Negative, zero or positive as `a` is older than, equal to or newer than `b`. */
export function compareVersions(a, b) {
  const left = parse(a)
  const right = parse(b)
  if (!left || !right) throw new Error(`cannot compare versions ${a} and ${b}`)
  for (let i = 0; i < 3; i++) {
    if (left.parts[i] !== right.parts[i]) return left.parts[i] - right.parts[i]
  }
  if (left.pre === right.pre) return 0
  if (left.pre === null) return 1
  if (right.pre === null) return -1
  return left.pre < right.pre ? -1 : 1
}

export function findDrift(locked, latestByName) {
  const drift = []
  for (const name of WATCHED) {
    const latest = latestByName[name]
    if (latest && compareVersions(latest, locked[name]) > 0) {
      drift.push({ name, locked: locked[name], latest })
    }
  }
  return drift
}

/** Stable identity of a drift set, so the issue changes only when npm does. */
export function driftKey(drift) {
  return drift.map(({ name, latest }) => `${name}@${latest}`).join(',')
}

export function keyFromIssueBody(body) {
  const match = String(body ?? '').match(new RegExp(`<!-- ${MARKER}: ([^ ]*) -->`))
  return match ? match[1] : null
}

export function issueBody(drift) {
  const rows = drift.map(({ name, locked, latest }) => `| \`${name}\` | ${locked} | ${latest} |`)
  return [
    `<!-- ${MARKER}: ${driftKey(drift)} -->`,
    'npm has a newer release of the bare toolchain than `.github/bare-toolchain/package-lock.json` pins. CI keeps building with the locked versions, so nothing is broken; this is the signal to review the release and move the lock.',
    '',
    '| Package | Locked | Latest |',
    '| --- | --- | --- |',
    ...rows,
    '',
    'To move the lock:',
    '',
    '1. Merge the Dependabot pull request for `/.github/bare-toolchain`, or run `npm install --package-lock-only` there after editing the `bare-make` pin.',
    '2. On that pull request, check the fabric prebuilds and cpp-lint from **On PR Trigger (Fabric)**, and dispatch **CPP Tests (nx)** on its branch with `packages: ["llm-llamacpp"]` for the coverage report.',
    '3. A new llvm-runtime major also moves the libc++ that fabric embeds and exports to every addon, so release fabric before the addons pick it up.',
    '',
    'This issue is updated when a newer release appears and closed once the lock catches up.',
  ].join('\n')
}

/**
 * First version-looking token of a tool's `--version` output. clang prints
 * "clang version 23.1.3 (...)" and bare-make prints the bare version.
 */
export function reportedVersion(output) {
  const match = String(output).match(/(\d+\.\d+\.\d+)/)
  return match ? match[1] : null
}

/** Mismatches between what the tools on PATH report and the lockfile. */
export function pathMismatches(locked, reported) {
  const expected = {
    'bare-make': locked['bare-make'],
    clang: locked['llvm-runtime'],
    'llvm-profdata': locked['llvm-runtime'],
  }
  const mismatches = []
  for (const [tool, version] of Object.entries(expected)) {
    const actual = reported[tool] ?? null
    if (actual !== version) mismatches.push({ tool, expected: version, actual })
  }
  return mismatches
}
