import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  WATCHED,
  compareVersions,
  driftKey,
  findDrift,
  issueBody,
  keyFromIssueBody,
  lockedVersions,
  pathMismatches,
  reportedVersion,
} from '../lib/bare-toolchain.mjs'

const lockfile = JSON.parse(
  readFileSync(new URL('../../bare-toolchain/package-lock.json', import.meta.url), 'utf8'),
)
const manifest = JSON.parse(
  readFileSync(new URL('../../bare-toolchain/package.json', import.meta.url), 'utf8'),
)

test('the lockfile pins every watched package', () => {
  const locked = lockedVersions(lockfile)
  assert.deepEqual(Object.keys(locked), WATCHED)
})

test('bare-make is pinned to one exact version, and the lockfile agrees', () => {
  const pin = manifest.dependencies['bare-make']
  assert.match(pin, /^\d+\.\d+\.\d+$/, 'a range would let a fresh install move without a lockfile change')
  assert.equal(lockfile.packages['']?.dependencies?.['bare-make'], pin)
  assert.equal(lockedVersions(lockfile)['bare-make'], pin)
})

test('no locked package runs an install script', () => {
  const scripted = Object.entries(lockfile.packages)
    .filter(([, entry]) => entry.hasInstallScript)
    .map(([path]) => path)
  assert.deepEqual(scripted, [])
})

test('a lockfile without a watched package is rejected', () => {
  const packages = { ...lockfile.packages }
  delete packages['node_modules/llvm-runtime']
  assert.throws(() => lockedVersions({ packages }), /llvm-runtime is missing/)
})

test('versions compare numerically, and a release sorts after its prerelease', () => {
  assert.ok(compareVersions('23.1.10', '23.1.9') > 0)
  assert.ok(compareVersions('2.1.1', '2.10.0') < 0)
  assert.equal(compareVersions('v2.1.1', '2.1.1'), 0)
  assert.ok(compareVersions('24.0.0', '24.0.0-rc.1') > 0)
  assert.ok(compareVersions('24.0.0-rc.1', '23.1.3') > 0)
})

test('only newer releases are drift', () => {
  const locked = lockedVersions(lockfile)
  assert.deepEqual(findDrift(locked, { ...locked }), [])

  const drift = findDrift(locked, { ...locked, 'llvm-runtime': '23.2.0', 'bare-make': '2.0.0' })
  assert.deepEqual(drift, [{ name: 'llvm-runtime', locked: locked['llvm-runtime'], latest: '23.2.0' }])
})

test('the issue body carries its drift key, so an unchanged drift is not re-posted', () => {
  const drift = [
    { name: 'bare-make', locked: '2.1.1', latest: '2.2.0' },
    { name: 'llvm-runtime', locked: '23.1.3', latest: '24.1.0' },
  ]
  const body = issueBody(drift)
  assert.equal(driftKey(drift), 'bare-make@2.2.0,llvm-runtime@24.1.0')
  assert.equal(keyFromIssueBody(body), driftKey(drift))
  assert.match(body, /\| `llvm-runtime` \| 23\.1\.3 \| 24\.1\.0 \|/)
  assert.equal(keyFromIssueBody('an issue edited by hand'), null)
})

test('tool versions are read from their --version banners', () => {
  assert.equal(reportedVersion('v2.1.1\n'), '2.1.1')
  assert.equal(
    reportedVersion('clang version 23.1.3 (https://github.com/llvm/llvm-project.git 0d261d1ca552)\nTarget: x86_64-unknown-linux-gnu'),
    '23.1.3',
  )
  assert.equal(reportedVersion('LLVM (http://llvm.org/):\n  LLVM version 23.1.3\n  Optimized build.'), '23.1.3')
  assert.equal(reportedVersion(''), null)
})

test('a host clang or a missing tool on PATH is a mismatch', () => {
  const locked = lockedVersions(lockfile)
  const llvm = locked['llvm-runtime']
  assert.deepEqual(
    pathMismatches(locked, { 'bare-make': locked['bare-make'], clang: llvm, 'llvm-profdata': llvm }),
    [],
  )
  assert.deepEqual(
    pathMismatches(locked, { 'bare-make': locked['bare-make'], clang: '19.1.7', 'llvm-profdata': null }),
    [
      { tool: 'clang', expected: llvm, actual: '19.1.7' },
      { tool: 'llvm-profdata', expected: llvm, actual: null },
    ],
  )
})
