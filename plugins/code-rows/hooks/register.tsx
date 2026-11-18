import { atom, read, update } from 'claude-code'
import type { ElementTable, Register, RenderElement } from 'claude-code'

import type { Settled } from '../types'

// Code Mode's tool (REPL, shown as Code) draws its script only in the ctrl+o
// transcript, behind a click, and the transcript folds the call into a group's
// count line. This draws each Code call as Write draws a file: a Code(summary)
// header, then the script highlighted under it, then what the call left: its
// logs (▸), its value (→) or its error (✘). The transcript shows the first
// lines of each; rows drawn in full (ctrl+o, --verbose) show all of them.
//
// A call Code Mode runs in the background answers `(dispatched #N)` at once,
// with `asyncDispatched` and `evalId` N in its result. What the script left
// reaches the model later, as a repl-eval event in a poll_events attachment;
// Claude Code shows a failure as a row of its own wherever it arrived. The
// attachment hook keeps each event by its eval number, so the outcome draws
// under its own call, and Claude Code's row for an error drawn there is hidden.

const PREVIEW = 6
const OUTCOME_PREVIEW = 3
const CODE_TOOLS = new Set(['REPL', 'Eval'])
const ERROR_ROW = 'repl-error-'
/** The short labels Claude Code writes for an error in place of its first line. */
const ERROR_LABEL = /^(Syntax error, so nothing ran|Interrupted|Stopped|Nothing ran:|Timed out after)/

type Script = { code: string; summary: string }
type Call = { input: unknown; output?: unknown; isRunning: boolean; isErrored: boolean; isInterrupted: boolean }
/** What a call left; `pending` while a background call has not settled. */
type Outcome = Settled & { pending: boolean }

const settled = atom({ plugin: 'code-rows', key: 'settled' } as const, {})

const EVENT = /<event\b([^>]*)>([\s\S]*?)<\/event>/g
const attr = (attrs: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(attrs)?.[1]
const unescape = (text: string) => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
const inner = (body: string, tag: string) =>
  [...body.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))].map(match => unescape(match[1] ?? '')).join('\n')

/** The repl-eval events a text carries, by eval number. */
function eventsOf(text: string): Record<string, Settled> {
  const found: Record<string, Settled> = {}
  for (const [, attrs = '', body = ''] of text.matchAll(EVENT)) {
    const id = attr(attrs, 'eval')
    if (attr(attrs, 'kind') !== 'repl-eval' || id === undefined) continue
    found[id] = { logs: inner(body, 'log'), value: inner(body, 'result'), error: inner(body, 'error') }
  }
  return found
}

/** The call's script and the summary its header shows: the description, else the first line. */
const scriptOf = (input: unknown): Script | undefined => {
  if (typeof input !== 'object' || input === null || !('code' in input)) return undefined
  const code = typeof input.code === 'string' ? input.code.replace(/\s+$/, '') : ''
  if (code.trim() === '') return undefined
  const description = 'description' in input && typeof input.description === 'string' ? input.description.trim() : ''
  return { code, summary: description || (code.split('\n').find(line => line.trim() !== '') ?? '').trim() }
}

const field = (output: object, name: string) => {
  const value: unknown = Reflect.get(output, name)
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * What the call left: from its own result (`{ code, result, stdout, stderr, error? }`, `result`
 * the script's last value already printed), or, for a background call, from its event.
 */
function outcomeOf(call: Call, background: Record<string, Settled>): Outcome | undefined {
  const output = call.output
  if (call.isRunning || typeof output !== 'object' || output === null) return undefined
  if ('asyncDispatched' in output && output.asyncDispatched === true) {
    const done = 'evalId' in output ? background[String(output.evalId)] : undefined
    return done ? { logs: done.logs.trim(), value: done.value.trim(), error: done.error.trim(), pending: false } : { logs: '', value: '', error: '', pending: true }
  }
  const value = field(output, 'result')
  return {
    logs: [field(output, 'stdout'), field(output, 'stderr')].filter(Boolean).join('\n'),
    value: value === 'undefined' ? '' : value,
    error: field(output, 'error'),
    pending: false,
  }
}

/** `text`'s lines cut to `limit` unless `whole`, with the count of those left out. */
const cut = (text: string, limit: number, whole: boolean) => {
  const lines = text === '' ? [] : text.split('\n')
  const shown = whole ? lines : lines.slice(0, limit)
  return { shown, hidden: lines.length - shown.length }
}

/** The dot's colour: grey while the call runs or its background run has not settled, red when it failed. */
const dotOf = (call: Call, outcome: Outcome | undefined) => {
  if (call.isRunning || outcome?.pending) return 'inactive'
  return call.isErrored || call.isInterrupted || (outcome?.error ?? '') !== '' ? 'error' : 'success'
}

/** A Code call's row: its header, its script, then what it left, each cut unless `whole`. */
function codeRow(
  { Box, Text, Code }: Pick<ElementTable, 'Box' | 'Text' | 'Code'>,
  call: Call,
  script: Script,
  whole: boolean,
  background: Record<string, Settled>,
): RenderElement {
  const outcome = outcomeOf(call, background)
  const more = (hidden: number) => hidden > 0 && <Text dimColor>{`… +${hidden} lines (ctrl+o to expand)`}</Text>
  const gutter = (mark: string, color: 'error' | undefined, ...body: (RenderElement | false)[]) => (
    <Box flexDirection="row">
      <Text color={color} dimColor={color === undefined}>{`  ${mark}  `}</Text>
      <Box flexDirection="column" flexGrow={1}>
        {body}
      </Box>
    </Box>
  )
  const source = cut(script.code, PREVIEW, whole)
  const logs = cut(outcome?.logs ?? '', OUTCOME_PREVIEW, whole)
  const value = cut(outcome?.value ?? '', OUTCOME_PREVIEW, whole)
  const [headline = '', ...detail] = (outcome?.error ?? '').split('\n')
  const error = cut(detail.join('\n'), OUTCOME_PREVIEW - 1, whole)
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box flexDirection="row">
        <Text color={dotOf(call, outcome)}>{'⏺ '}</Text>
        <Text wrap="truncate-end">
          <Text bold>Code</Text>
          {`(${script.summary})`}
        </Text>
      </Box>
      {gutter('⎿', undefined,
        <Code source={source.shown.join('\n')} language="javascript" />,
        more(source.hidden)
      )}
      {outcome?.pending && gutter('…', undefined, <Text dimColor>running in the background</Text>)}
      {logs.shown.length > 0 && gutter('▸', undefined,
        <Text dimColor>{logs.shown.join('\n')}</Text>,
        more(logs.hidden)
      )}
      {value.shown.length > 0 && gutter('→', undefined,
        <Code source={value.shown.join('\n')} language="javascript" />,
        more(value.hidden)
      )}
      {headline !== '' && gutter('✘', 'error',
        <Text color="error">{headline}</Text>,
        error.shown.length > 0 && <Text dimColor>{error.shown.join('\n')}</Text>,
        more(error.hidden)
      )}
    </Box>
  )
}

/** Whether Claude Code's own row for `text` repeats an error a Code row already draws. */
function drawnOnCall(text: string, background: Record<string, Settled>): boolean {
  const errors = Object.values(background).map(done => done.error.trim()).filter(Boolean)
  return errors.some(error => error.split('\n')[0] === text.trim()) || (ERROR_LABEL.test(text.trim()) && errors.length > 0)
}

export const register: Register = on => {
  // Keeps each repl-eval event the model is sent; the attachment passes on unchanged.
  on('prompt.attachment', async ($, e, next) => {
    if (e.text.includes('kind="repl-eval"')) {
      const found = eventsOf(e.text)
      if (Object.keys(found).length > 0) await update($, settled, current => ({ ...current, ...found }))
    }
    return next(e)
  })

  // A folded group: each Code call's row above the group's own count line.
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (e.component !== 'ToolGroup' || e.props.isExpanded) return next(e)
    const rows = e.props.calls.flatMap(call => {
      const script = CODE_TOOLS.has(call.tool) ? scriptOf(call.input) : undefined
      return script ? [{ call, script }] : []
    })
    if (rows.length === 0) return next(e)
    const background = await read($, settled)
    const table = $.ui.resolve(e)
    const { Box } = table
    return (
      <Box flexDirection="column">
        {rows.map(({ call, script }) => codeRow(table, call, script, false, background))}
        {await next(e)}
      </Box>
    )
  })

  // A call drawn as its own row: the engine draws Code Mode's script collapsed behind a click there.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (e.component !== 'ToolUse' || !CODE_TOOLS.has(e.props.tool)) return next(e)
    const script = scriptOf(e.props.input)
    if (script === undefined) return next(e)
    return codeRow($.ui.resolve(e), e.props, script, e.props.isExpanded === true, await read($, settled))
  })

  // Claude Code's error line for a Code call: the call's own row draws it already.
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (e.component !== 'ToolResult' || !CODE_TOOLS.has(e.props.tool) || !e.props.isErrored) return next(e)
    const { Box } = $.ui.resolve(e)
    if (!e.props.tool_use_id.startsWith(ERROR_ROW)) return <Box />
    const output = e.props.output
    const text = typeof output === 'object' && output !== null ? field(output, 'error') : ''
    return drawnOnCall(text, await read($, settled)) ? <Box /> : next(e)
  })
}
