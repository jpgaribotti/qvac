'use strict'

const path = require('path')
const os = require('os')
const { spawnSync } = require('child_process')

const binary = os.platform() === 'win32' ? 'addon-test.exe' : './addon-test'
const cwd = path.resolve(__dirname, '..', 'build', 'test', 'unit')

// addon-test links AddressSanitizer but dynamically loads the non-ASan,
// -static-libstdc++ @qvac/fabric prebuild. Objects that cross that module
// boundary trip alloc-dealloc-mismatch, and fabric's long-lived runtime globals
// plus its dlopen'd ggml backends look like leaks at exit -- both fire after
// every test has already passed. Relax exactly those two checks, matching
// .github/workflows/cpp-tests-classification.yml. An ASAN_OPTIONS already in
// the environment wins, so CI and ad-hoc overrides stay authoritative.
// See test/unit/CMakeLists.txt for the full rationale.
const DEFAULT_ASAN_OPTIONS = 'alloc_dealloc_mismatch=0:detect_leaks=0:abort_on_error=1'

const result = spawnSync(binary, ['--gtest_output=xml:cpp-test-results.xml'], {
  cwd,
  stdio: 'inherit',
  shell: false,
  env: {
    ...process.env,
    ASAN_OPTIONS: process.env.ASAN_OPTIONS || DEFAULT_ASAN_OPTIONS
  }
})

if (result.error) {
  throw result.error
}

// abort_on_error=1 makes a genuine sanitizer finding raise SIGABRT, which
// leaves status null -- report those as a failure instead of exiting 0.
if (result.signal) {
  console.error(`addon-test terminated by signal ${result.signal}`)
  process.exit(1)
}

process.exit(result.status ?? 1)
