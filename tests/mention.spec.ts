/**
 * Host @path reference behavior: token recognition, workspace confinement,
 * existence/kind markers, and the unknown-path/non-user-source skips.
 */
import { mkdtemp, mkdir, symlink, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { expandMentions, mentionPreStep, scanMentions } from '../src/mention.ts'
import { protectPastedMentions } from '../src/paste.ts'

function user(text: string): UserMessage {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
}

describe('scanMentions', () => {
  it('recognizes @path tokens, strips the directory slash, and deduplicates', () => {
    expect(scanMentions('fix @src/index.ts and @docs/ ')).toEqual(['src/index.ts', 'docs'])
    expect(scanMentions('@a.ts again @a.ts')).toEqual(['a.ts'])
  })

  it('skips protected pasted tokens by default and restores them when the setting is off', () => {
    const pasted = protectPastedMentions('read @a.ts')
    expect(scanMentions(pasted)).toEqual([])
    expect(scanMentions(pasted, false)).toEqual(['a.ts'])
  })
})

describe('expandMentions', () => {
  it('injects only a validated file reference, never its content', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-at-file-mention-'))
    await writeFile(join(root, 'a.ts'), 'private content that must not be injected\n')
    try {
      const injections = await expandMentions([user('read @a.ts')], root, new AbortController().signal)
      expect(injections).toHaveLength(1)
      expect(injections[0]!.source).toEqual({ kind: 'at-file-mention', relative: 'a.ts' })
      expect(injections[0]!.content[0]).toEqual({
        type: 'text',
        text: '<workspace-reference path="a.ts" kind="file" />',
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('treats a directory as one reference without indexing descendants', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-at-file-mention-'))
    await mkdir(join(root, 'src', 'nested'), { recursive: true })
    await writeFile(join(root, 'src', 'nested', 'large.bin'), Buffer.alloc(512 * 1024, 0xff))
    try {
      const injections = await expandMentions([user('inspect @src/')], root, new AbortController().signal)
      expect(injections[0]!.content[0]).toEqual({
        type: 'text',
        text: '<workspace-reference path="src" kind="directory" />',
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('represents the workspace root as one directory reference', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-at-file-mention-'))
    try {
      const injections = await expandMentions([user('inspect @./')], root, new AbortController().signal)
      expect(injections[0]!.content[0]).toEqual({
        type: 'text',
        text: '<workspace-reference path="." kind="directory" />',
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('references large binary and PDF paths exactly like text paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-at-file-mention-'))
    await writeFile(join(root, 'report.pdf'), Buffer.alloc(512 * 1024, 0xff))
    try {
      const injections = await expandMentions([user('review @report.pdf')], root, new AbortController().signal)
      expect(injections[0]!.content[0]).toEqual({
        type: 'text',
        text: '<workspace-reference path="report.pdf" kind="file" />',
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('escapes a referenced path attribute', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-at-file-mention-'))
    await writeFile(join(root, 'a&b".txt'), 'x')
    try {
      const injections = await expandMentions([user('read @a&b".txt')], root, new AbortController().signal)
      expect(injections[0]!.content[0]).toEqual({
        type: 'text',
        text: '<workspace-reference path="a&amp;b&quot;.txt" kind="file" />',
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('skips non-text blocks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-at-file-mention-'))
    try {
      const message = createUserMessage({
        content: [{ type: 'text', text: 'no mention' }, { type: 'image', attachment: { attachmentId: 'x' } as never }],
        source: { kind: 'user' },
      })
      expect(await expandMentions([message], root, new AbortController().signal)).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('skips unknown paths and non-user message sources', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-at-file-mention-'))
    try {
      expect(await expandMentions([user('read @missing.ts')], root, new AbortController().signal)).toEqual([])
      const plugin = createUserMessage({ content: [{ type: 'text', text: '@a.ts' }], source: { kind: 'plugin', plugin: 'x' } })
      await writeFile(join(root, 'a.ts'), 'x\n')
      expect(await expandMentions([plugin], root, new AbortController().signal)).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('refuses tokens that escape the workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-at-file-mention-'))
    const absolute = join(root, 'inside.ts')
    await writeFile(absolute, 'x\n')
    try {
      expect(await expandMentions([user(`read @${absolute}`)], root, new AbortController().signal)).toEqual([])
      expect(await expandMentions([user('read @../secret.ts')], root, new AbortController().signal)).toEqual([])
      expect(await expandMentions([user('read @src/../../secret.ts')], root, new AbortController().signal)).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('refuses a token that resolves through an escaping symlink', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-at-file-mention-'))
    const outside = await mkdtemp(join(tmpdir(), 'dsh-at-file-mention-out-'))
    try {
      await writeFile(join(outside, 'secret.txt'), 'secret\n')
      await symlink(outside, join(root, 'notes'), 'dir')
      expect(await expandMentions([user('read @notes/secret.txt')], root, new AbortController().signal)).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(outside, { recursive: true, force: true })
    }
  })

  it('resolves a token through an internal symlink with the correct kind', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-at-file-mention-'))
    try {
      await mkdir(join(root, 'real'), { recursive: true })
      await writeFile(join(root, 'real', 'file.txt'), 'x\n')
      await symlink(join(root, 'real'), join(root, 'link'), 'dir')
      const injections = await expandMentions([user('read @link/file.txt')], root, new AbortController().signal)
      expect(injections).toHaveLength(1)
      expect(injections[0]!.content[0]).toEqual({
        type: 'text',
        text: '<workspace-reference path="link/file.txt" kind="file" />',
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('resolves the bare root token through the rel === "" containment case', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-at-file-mention-'))
    try {
      const injections = await expandMentions([user('inspect @.')], root, new AbortController().signal)
      expect(injections).toHaveLength(1)
      expect(injections[0]!.content[0]).toEqual({
        type: 'text',
        text: '<workspace-reference path="." kind="directory" />',
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('injects nothing for a planted external-alias key like notes/id_ed25519', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-at-file-mention-'))
    const outside = await mkdtemp(join(tmpdir(), 'dsh-at-file-mention-ssh-'))
    try {
      await writeFile(join(outside, 'id_ed25519'), 'private key material\n')
      await symlink(outside, join(root, 'notes'), 'dir')
      expect(await expandMentions([user('look at @notes/id_ed25519')], root, new AbortController().signal)).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(outside, { recursive: true, force: true })
    }
  })

  it('injects nothing when the workspace root cannot be canonicalized', async () => {
    const missing = join(tmpdir(), 'dsh-at-file-mention-missing-root')
    expect(await expandMentions([user('read @a.ts')], missing, new AbortController().signal)).toEqual([])
  })

  it('treats a relative cwd as unavailable', async () => {
    expect(await expandMentions([user('read @a.ts')], 'relative/cwd', new AbortController().signal)).toEqual([])
  })

  it('keeps cancellation fatal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-at-file-mention-'))
    const controller = new AbortController()
    controller.abort(new Error('cancel reference'))
    try {
      await expect(expandMentions([user('@anything')], root, controller.signal)).rejects.toThrow('cancel reference')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('mentionPreStep', () => {
  const agent = { session: { header: { cwd: '/ws' } } }

  it('appends references to the downstream enter decision', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-at-file-mention-'))
    await writeFile(join(root, 'a.ts'), 'x\n')
    try {
      const decision = await mentionPreStep(
        { session: { header: { cwd: root } } },
        () => true,
        [user('read @a.ts')],
        new AbortController().signal,
        async () => ({ kind: 'enter', messages: [] }),
      )
      expect(decision.kind).toBe('enter')
      expect(decision.messages).toHaveLength(1)
      expect(decision.messages![0]!.source).toEqual({ kind: 'at-file-mention', relative: 'a.ts' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('returns the downstream decision when disabled or rejected', async () => {
    const decision = async () => ({ kind: 'enter', messages: [] })
    const disabled = await mentionPreStep(agent, () => false, [user('@a.ts')], new AbortController().signal, decision)
    expect(disabled.messages).toEqual([])
    const rejected = await mentionPreStep(agent, () => true, [user('@a.ts')], new AbortController().signal, async () => ({ kind: 'reject' }))
    expect(rejected.kind).toBe('reject')
    const unmatched = await mentionPreStep(agent, () => true, [user('@missing.ts')], new AbortController().signal, decision)
    expect(unmatched.messages).toEqual([])
  })

  it('does not inject or expose pasted references when the setting is enabled', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-at-file-mention-'))
    await writeFile(join(root, 'a.ts'), 'x\n')
    try {
      const pasted = protectPastedMentions('please keep @a.ts as text')
      const decision = await mentionPreStep(
        { session: { header: { cwd: root } } },
        () => true,
        [user(pasted)],
        new AbortController().signal,
        async () => ({ kind: 'enter', messages: [user(pasted)] }),
      )
      expect(decision.kind).toBe('enter')
      expect(decision.messages).toHaveLength(1)
      expect(decision.messages[0]!.content[0]).toEqual({ type: 'text', text: 'please keep @a.ts as text' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('restores the legacy behavior when pasted-mention filtering is disabled', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-at-file-mention-'))
    await writeFile(join(root, 'a.ts'), 'x\n')
    try {
      const pasted = protectPastedMentions('read @a.ts')
      const decision = await mentionPreStep(
        { session: { header: { cwd: root } } },
        () => true,
        [user(pasted)],
        new AbortController().signal,
        async () => ({ kind: 'enter', messages: [] }),
        () => false,
      )
      expect(decision.kind).toBe('enter')
      expect(decision.messages).toHaveLength(1)
      expect(decision.messages[0]!.source).toEqual({ kind: 'at-file-mention', relative: 'a.ts' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
