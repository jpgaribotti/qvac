const test = require('brittle')
const Thread = require('bare-thread')
const addon = require('.')

// Option D (see arch/qips/logger-multi-env-singleton.md): the JsLogger singleton
// supports a single live owning env at a time. These tests exercise that
// contract using real concurrent envs spawned via bare-thread (each Thread is a
// separate js_env_t with its own uv_loop).

function delay (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForFlag (flags, index, timeout = 5000) {
  const start = Date.now()
  while (Atomics.load(flags, index) === 0) {
    if (Date.now() - start >= timeout) {
      throw new Error(`timed out waiting for flag ${index}`)
    }
    await delay(5)
  }
}

// A second, concurrently-live env calling setLogger must be rejected rather than
// silently hijacking the callback/handle (which leaks the first env's ref and
// leaves logger_async_ bound to the wrong loop).
//
// EXPECTED TO FAIL before the Option D fix: today the second setLogger returns
// undefined (no throw) and hijacks the singleton.
test('setLogger from a second live env is rejected', async (t) => {
  t.timeout(15000)

  const OWNS = 0
  const DONE = 1
  const flags = new Int32Array(new SharedArrayBuffer(2 * Int32Array.BYTES_PER_ELEMENT))

  const worker = new Thread('./worker-set-hold.js', { data: flags.buffer })

  // Wait until the worker env owns the logger, so our setLogger is genuinely
  // a second live env rather than a first install.
  await waitForFlag(flags, OWNS)

  let threw = false
  try {
    addon.setLogger((prio, msg) => {})
  } catch {
    threw = true
  }

  t.ok(threw, 'second live env setLogger throws instead of hijacking the singleton')

  // NOTE: if it did not throw (pre-fix), the main env has hijacked the singleton.
  // We deliberately do NOT releaseLogger() from the main env here: the async
  // handle belongs to the worker's loop, so closing it from this thread would be
  // a cross-thread uv_close. Let the worker release on its own loop below.

  Atomics.store(flags, DONE, 1)
  Atomics.notify(flags, DONE)
  worker.join()
})

// Regression guard: the reject must not break the supported sequential reload
// pattern (env A installs + releases, then env B installs). Passes before and
// after the fix; it exists so the reject logic can't over-reject legit reloads.
test('sequential handoff across envs keeps working', async (t) => {
  t.timeout(15000)

  const SET_OK = 0
  const RECV = 1

  async function runOwner () {
    const flags = new Int32Array(new SharedArrayBuffer(2 * Int32Array.BYTES_PER_ELEMENT))
    const worker = new Thread('./worker-set-release.js', { data: flags.buffer })
    worker.join()
    return { setOk: Atomics.load(flags, SET_OK), recv: Atomics.load(flags, RECV) }
  }

  const first = await runOwner()
  t.is(first.setOk, 1, 'first env installed the logger')
  t.ok(first.recv >= 1, 'first env received its own log')

  const second = await runOwner()
  t.is(second.setOk, 1, 'second env installed the logger after the first released')
  t.ok(second.recv >= 1, 'second env received its own log')
})
