import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { PluginUpdateRollbackError, commitStagedPluginUpdate } from './updateTransaction.ts'

async function writePluginMarker(root: string, marker: string): Promise<void> {
  await mkdir(root, { recursive: true })
  await writeFile(join(root, 'marker.txt'), marker, 'utf-8')
}

test('same-volume staged update validates and trial-activates before switching active version', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'twilight-plugin-update-success-'))
  t.after(async () => {
    await rm(root, { recursive: true, force: true })
  })
  const stagingRoot = join(root, 'plugin-staging', 'transaction')
  const candidateRoot = join(stagingRoot, 'candidate')
  const targetRoot = join(root, 'plugins', 'com.example.transactional', '2.0.0')
  const previousRoot = join(root, 'plugins', 'com.example.transactional', '1.0.0')
  await writePluginMarker(candidateRoot, 'candidate-2.0.0')
  await writePluginMarker(previousRoot, 'active-1.0.0')

  let activeVersion = '1.0.0'
  const order: string[] = []
  await commitStagedPluginUpdate({
    stagingRoot,
    candidateRoot,
    targetRoot,
    validateCandidate: async () => {
      order.push('validate')
    },
    trialActivateCandidate: async () => {
      order.push('trial')
    },
    commitActiveVersion: async () => {
      order.push('commit')
      activeVersion = '2.0.0'
    },
    activateCommittedCandidate: async () => {
      order.push('activate')
    },
    rollbackActiveVersion: async () => {
      activeVersion = '1.0.0'
    },
    restorePreviousVersion: async () => {
      order.push('restore')
    }
  })

  assert.deepEqual(order, ['validate', 'trial', 'commit', 'activate'])
  assert.equal(activeVersion, '2.0.0')
  assert.equal(await readFile(join(targetRoot, 'marker.txt'), 'utf-8'), 'candidate-2.0.0')
  assert.equal(await readFile(join(previousRoot, 'marker.txt'), 'utf-8'), 'active-1.0.0')
  await assert.rejects(() => access(candidateRoot))
})

test('activation failure restores the active pointer, previous target, and prior runtime', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'twilight-plugin-update-rollback-'))
  t.after(async () => {
    await rm(root, { recursive: true, force: true })
  })
  const stagingRoot = join(root, 'plugin-staging', 'transaction')
  const candidateRoot = join(stagingRoot, 'candidate')
  const targetRoot = join(root, 'plugins', 'com.example.transactional', '2.0.0')
  const previousRoot = join(root, 'plugins', 'com.example.transactional', '1.0.0')
  await writePluginMarker(candidateRoot, 'new-candidate')
  await writePluginMarker(targetRoot, 'preexisting-target')
  await writePluginMarker(previousRoot, 'previous-active')

  let activeVersion = '1.0.0'
  let restartCount = 0
  await assert.rejects(
    () =>
      commitStagedPluginUpdate({
        stagingRoot,
        candidateRoot,
        targetRoot,
        validateCandidate: async () => undefined,
        trialActivateCandidate: async () => undefined,
        commitActiveVersion: async () => {
          activeVersion = '2.0.0'
        },
        activateCommittedCandidate: async () => {
          throw new Error('candidate activation failed')
        },
        rollbackActiveVersion: async () => {
          activeVersion = '1.0.0'
        },
        restorePreviousVersion: async () => {
          restartCount += 1
        }
      }),
    /candidate activation failed/
  )

  assert.equal(activeVersion, '1.0.0')
  assert.equal(restartCount, 1)
  assert.equal(await readFile(join(targetRoot, 'marker.txt'), 'utf-8'), 'preexisting-target')
  assert.equal(await readFile(join(previousRoot, 'marker.txt'), 'utf-8'), 'previous-active')
  await assert.rejects(() => access(join(stagingRoot, 'previous-target')))
})

test('rollback failures remain observable instead of being swallowed after activation failure', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'twilight-plugin-update-rollback-error-'))
  t.after(async () => {
    await rm(root, { recursive: true, force: true })
  })
  const stagingRoot = join(root, 'plugin-staging', 'transaction')
  const candidateRoot = join(stagingRoot, 'candidate')
  const targetRoot = join(root, 'plugins', 'com.example.transactional', '2.0.0')
  await writePluginMarker(candidateRoot, 'new-candidate')

  await assert.rejects(
    () =>
      commitStagedPluginUpdate({
        stagingRoot,
        candidateRoot,
        targetRoot,
        validateCandidate: async () => undefined,
        trialActivateCandidate: async () => undefined,
        commitActiveVersion: async () => undefined,
        activateCommittedCandidate: async () => {
          throw new Error('candidate activation failed')
        },
        rollbackActiveVersion: async () => {
          throw new Error('durable active version rollback failed')
        },
        restorePreviousVersion: async () => {
          throw new Error('previous runtime restart failed')
        }
      }),
    (error: unknown) => {
      assert.ok(error instanceof PluginUpdateRollbackError)
      assert.match(error.message, /rollback did not complete/)
      assert.equal(
        error.activationError instanceof Error && error.activationError.message,
        'candidate activation failed'
      )
      assert.deepEqual(
        error.failures.map((failure) => [failure.phase, failure.message]),
        [
          ['active-version', 'durable active version rollback failed'],
          ['previous-runtime', 'previous runtime restart failed']
        ]
      )
      return true
    }
  )
})

test('transaction rejects a candidate outside its same-volume staging directory', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'twilight-plugin-update-boundary-'))
  t.after(async () => {
    await rm(root, { recursive: true, force: true })
  })
  const stagingRoot = join(root, 'plugin-staging', 'transaction')
  const candidateRoot = join(root, 'outside-candidate')
  const targetRoot = join(root, 'plugins', 'com.example.transactional', '2.0.0')
  await writePluginMarker(candidateRoot, 'outside')

  await assert.rejects(
    () =>
      commitStagedPluginUpdate({
        stagingRoot,
        candidateRoot,
        targetRoot,
        validateCandidate: async () => undefined,
        trialActivateCandidate: async () => undefined,
        commitActiveVersion: async () => undefined,
        activateCommittedCandidate: async () => undefined,
        rollbackActiveVersion: async () => undefined,
        restorePreviousVersion: async () => undefined
      }),
    /candidate must be contained/
  )
})

test('transaction rejects cross-volume staging before activation on Windows', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('Cross-volume drive roots are Windows-specific.')
    return
  }
  const stagingRoot = 'C:\\twilight-staging\\transaction'
  await assert.rejects(
    () =>
      commitStagedPluginUpdate({
        stagingRoot,
        candidateRoot: join(stagingRoot, 'candidate'),
        targetRoot: 'Z:\\twilight-plugins\\com.example.transactional\\2.0.0',
        validateCandidate: async () => undefined,
        trialActivateCandidate: async () => undefined,
        commitActiveVersion: async () => undefined,
        activateCommittedCandidate: async () => undefined,
        rollbackActiveVersion: async () => undefined,
        restorePreviousVersion: async () => undefined
      }),
    /same volume/
  )
})
