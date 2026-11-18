import { atom, memberOf, read, update } from 'claude-code'
import type { ElementTable, EngineInterface, Register, RenderElement } from 'claude-code'

import type { Settled } from '../types'

// Code Mode's tool (REPL, shown as Code) draws its script only in the ctrl+o
// transcript, behind a click, and the transcript folds the call into a group's
// count line. This draws each Code call as Write draws a file: a Code(summary)
// header, then the script highlighted under it, the first PREVIEW lines in the
// transcript and all of it where rows are drawn in full (ctrl+o, --verbose).
//
// What the call returned (→) or threw (✘) draws where the script finished: under
// the last row of the tools it called, which Claude Code draws after the call,
// or under the call when it called none. A call Code Mode runs in the background
// answers `(dispatched #N)` at once, with `asyncDispatched` and `evalId` N in its
// result; what it left reaches the model later, as a repl-eval event, which the
// attachment hook keeps by eval number. Claude Code's own row for an error drawn
// here is hidden. In a folded group, Claude Code's count line already shows each
// error, so the row there draws the value alone.

const PREVIEW = 6
const OUTCOME_PREVIEW = 3
/** How many lines of each part of a result a row drawn in full shows until it is clicked. */
const FULL_PREVIEW = 12
/** How many of a script's tool calls a folded group's trail names. */
const TRAIL_PREVIEW = 3
/** The input fields that name what a tool call was about, in the order a trail looks for them. */
const SUBJECT_FIELDS = ['file_path', 'path', 'command', 'pattern', 'url', 'query', 'description']
/** How many of the session's newest rows a layout reads. */
const ROWS_READ = 1000
const CODE_TOOLS = new Set(['REPL', 'Eval'])
const ERROR_ROW = 'repl-error-'
/** The short labels Claude Code writes for an error in place of its first line. */
const ERROR_LABEL = /^(Syntax error, so nothing ran|Interrupted|Stopped|Nothing ran:|Timed out after)/

type Script = { code: string; summary: string }
type Call = { output?: unknown; isRunning: boolean; isErrored: boolean; isInterrupted: boolean }
/** What a call left; `pending` while a background call has not settled. */
type Outcome = { logs: string; value: string; error: string; pending: boolean }
/** Which rows the tools a script called draw as, from the session's rows in order. */
type Layout = {
  known: Set<string>
  calls: Map<string, Call>
  scripts: Map<string, Script>
  codeOf: Map<string, string>
  lastInner: Map<string, string>
  /** The repl-eval events the session's messages carry, by eval number. */
  events: Record<string, Settled>
  settledCount: number
}

/** The id prefix of a row Code Mode adds for a tool a script called. */
const INNER_ROW = 'repl_'

const settled = atom({ plugin: 'code-rows', key: 'settled' } as const, {})
const shown = atom({ plugin: 'code-rows', key: 'shown' } as const, false)

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
    return done
      ? { logs: (done.logs ?? '').trim(), value: done.value.trim(), error: done.error.trim(), pending: false }
      : { logs: '', value: '', error: '', pending: true }
  }
  const value = field(output, 'result')
  return {
    logs: [field(output, 'stdout'), field(output, 'stderr')].filter(Boolean).join('\n'),
    value: value === 'undefined' ? '' : value,
    error: field(output, 'error'),
    pending: false,
  }
}

/** A trail line for a tool call: its name and what it was about, a path as its last part. */
function trailLine(tool: string, input: unknown): string {
  const record = typeof input === 'object' && input !== null ? input : {}
  const subject = SUBJECT_FIELDS.map(name => (name in record ? Reflect.get(record, name) : undefined)).find(value => typeof value === 'string')
  if (typeof subject !== 'string') return tool
  const line = (subject.split('\n')[0] ?? '').trim()
  const shown = /^[~/]/.test(line) && !line.includes(' ') ? (line.split('/').pop() ?? line) : line
  return `${tool} ${shown.length > 60 ? `${shown.slice(0, 59)}…` : shown}`
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

type Table = Pick<ElementTable, 'Box' | 'Text' | 'Code' | 'Button'>
/** A row drawn in full: whether its result shows whole, and the press that flips it. */
type Fold = { isShown: boolean; toggle: () => Promise<void> }

const gutter = ({ Box, Text }: Table, mark: string, color: 'error' | undefined, ...body: (RenderElement | false)[]) => (
  <Box flexDirection="row">
    <Text color={color} dimColor={color === undefined}>{`  ${mark}  `}</Text>
    <Box flexDirection="column" flexGrow={1}>
      {body}
    </Box>
  </Box>
)

const more = ({ Text }: Table, hidden: number) => hidden > 0 && <Text dimColor>{`… +${hidden} lines (ctrl+o to expand)`}</Text>

/** The count line under a cut part of a result: in a row drawn in full, a click shows the part whole, or cuts it again. */
const moreOrToggle = (table: Table, part: string, hidden: number, fold: Fold | undefined) => {
  if (fold === undefined) return more(table, hidden)
  if (hidden === 0 && !fold.isShown) return false
  const { Button } = table
  const label = fold.isShown ? 'click to show less' : `… +${hidden} lines · click to show all`
  return <Button key={`more-${part}`} plain dimColor label={label} onPress={fold.toggle} />
}

/**
 * What the call logged (▸, with `logs`), returned (→) or threw (✘), cut unless `whole`; the error left out
 * when `errors` is false.
 */
function outcomeRows(table: Table, outcome: Outcome | undefined, fold: Fold | undefined, errors: boolean, logs: boolean): (RenderElement | false)[] {
  const { Text, Code } = table
  const whole = fold?.isShown === true
  const limit = fold === undefined ? OUTCOME_PREVIEW : FULL_PREVIEW
  const logged = cut(logs ? (outcome?.logs ?? '') : '', limit, whole)
  const value = cut(outcome?.value ?? '', limit, whole)
  const [headline = '', ...detail] = (errors ? (outcome?.error ?? '') : '').split('\n')
  const error = cut(detail.join('\n'), limit - 1, whole)
  return [
    logged.shown.length > 0 &&
      gutter(table, '▸', undefined, <Text dimColor>{logged.shown.join('\n')}</Text>, moreOrToggle(table, 'logs', logged.hidden, fold)),
    value.shown.length > 0 &&
      gutter(table, '→', undefined, <Code source={value.shown.join('\n')} language="javascript" />, moreOrToggle(table, 'value', value.hidden, fold)),
    headline !== '' &&
      gutter(
        table,
        '✘',
        'error',
        <Text color="error">{headline}</Text>,
        error.shown.length > 0 && <Text dimColor>{error.shown.join('\n')}</Text>,
        moreOrToggle(table, 'error', error.hidden, fold),
      ),
  ]
}

/**
 * A Code call's row: its header, its script cut unless `whole`, and, when `ownOutcome`, what the
 * call left; otherwise the last row of the tools the script called draws that. `errors` is false in
 * a folded group, whose count line shows each error and whose rows are not drawn again once a
 * background call settles, so no waiting note goes there either.
 */
function codeRow(
  table: Table,
  call: Call,
  script: Script,
  whole: boolean,
  background: Record<string, Settled>,
  ownOutcome: boolean,
  errors: boolean,
  trail: readonly string[],
  fold: Fold | undefined,
): RenderElement {
  const { Box, Text, Code } = table
  const outcome = outcomeOf(call, background)
  const source = cut(script.code, PREVIEW, whole)
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box flexDirection="row">
        <Text color={dotOf(call, outcome)}>{'⏺ '}</Text>
        <Text wrap="truncate-end">
          <Text bold>Code</Text>
          {`(${script.summary})`}
        </Text>
      </Box>
      {gutter(table, '⎿', undefined, <Code source={source.shown.join('\n')} language="javascript" />, more(table, source.hidden))}
      {trail.length > 0 &&
        gutter(table, '·', undefined, <Text dimColor>{trail.slice(0, TRAIL_PREVIEW).join('\n')}</Text>, trail.length > TRAIL_PREVIEW && <Text dimColor>{`… +${trail.length - TRAIL_PREVIEW} more`}</Text>)}
      {errors && outcome?.pending && gutter(table, '…', undefined, <Text dimColor>running in the background</Text>)}
      {ownOutcome && outcomeRows(table, outcome, fold, errors, errors)}
    </Box>
  )
}

/**
 * The row that ends a script's trail: after the rows of the tools it called, the call's summary with
 * what it returned or threw, so the result reads as the script's and not the last tool's.
 */
function resultRow(table: Table, call: Call, script: Script, background: Record<string, Settled>, fold: Fold | undefined, logs: boolean): RenderElement | false {
  const { Box, Text } = table
  const outcome = outcomeOf(call, background)
  if (outcome === undefined || outcome.pending) return false
  const failed = outcome.error !== ''
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box flexDirection="row">
        <Text color={dotOf(call, outcome)}>{'⏺ '}</Text>
        <Text wrap="truncate-end">
          <Text bold>Code</Text>
          {`(${script.summary}) `}
          <Text dimColor>{failed ? 'failed' : 'returned'}</Text>
        </Text>
      </Box>
      {outcomeRows(table, outcome, fold, true, logs)}
    </Box>
  )
}

/** `row` with, under it, the script's result row when it is the last row of the tools that script called. */
async function withOutcome(
  placed: Layout,
  table: Table,
  id: string,
  background: Record<string, Settled>,
  fold: Fold | undefined,
  logs: boolean,
  row: Promise<RenderElement>,
): Promise<RenderElement> {
  const parent = placed.codeOf.get(id)
  const call = parent === undefined ? undefined : placed.calls.get(parent)
  const script = call === undefined ? undefined : placed.scripts.get(parent ?? '')
  if (parent === undefined || call === undefined || script === undefined || placed.lastInner.get(parent) !== id) return row
  const { Box } = table
  return (
    <Box flexDirection="column">
      {await row}
      {resultRow(table, call, script, background, fold, logs)}
    </Box>
  )
}

// In ctrl+o, Claude Code draws each tool row's result as a row of its own, after the tool's
// header, so the end of a script's trail goes under the last tool's result row. The default view
// folds a script's calls into one group, which draws the trail itself.

/** The texts of a message's content: its text blocks and its tool results', where events arrive. */
function textsOf(content: unknown): string[] {
  if (typeof content === 'string') return [content]
  if (!Array.isArray(content)) return []
  return content.flatMap((block: unknown) => {
    if (typeof block !== 'object' || block === null) return []
    if ('text' in block && typeof block.text === 'string') return [block.text]
    return 'content' in block ? textsOf(block.content) : []
  })
}

let layout: Layout | undefined

/** For a row drawn in full, whether its result shows whole, read so a click redraws it, and the press that flips it. */
async function foldFor($: EngineInterface, e: { requestId: string }, whole: boolean): Promise<Fold | undefined> {
  if (!whole) return undefined
  const member = memberOf(shown, e)
  return { isShown: await read($, member), toggle: async () => void (await update($, member, isShown => !isShown)) }
}

/**
 * The session's layout around `id` and every result known: the events its messages carry, and those
 * the attachment hook kept since, which also redraws the rows that read them.
 */
async function known($: EngineInterface, id: string): Promise<{ placed: Layout; background: Record<string, Settled> }> {
  const kept = await read($, settled)
  const placed = await layoutFor($, id, Object.keys(kept).length)
  return { placed, background: { ...placed.events, ...kept } }
}

/**
 * The session's Code calls and the rows of the tools each called, read again when a row is not in the
 * last read or a background call has settled since.
 */
async function layoutFor($: EngineInterface, id: string, settledCount: number): Promise<Layout> {
  if (layout && layout.known.has(id) && layout.settledCount === settledCount) return layout
  const rows = await $.session.messages({ last: ROWS_READ })
  const api = await $.session.messages({ as: 'api', last: ROWS_READ })
  const events: Record<string, Settled> = {}
  for (const text of Array.isArray(api) ? api.flatMap(message => textsOf(message.content)) : []) {
    if (text.includes('kind="repl-eval"')) Object.assign(events, eventsOf(text))
  }
  const next: Layout = { known: new Set(), calls: new Map(), scripts: new Map(), codeOf: new Map(), lastInner: new Map(), events, settledCount }
  let current: string | undefined
  for (const row of Array.isArray(rows) ? rows : []) {
    for (const use of row.toolUses) {
      next.known.add(use.tool_use_id)
      const script = CODE_TOOLS.has(use.tool) ? scriptOf(use.input) : undefined
      if (script) {
        current = use.tool_use_id
        next.scripts.set(current, script)
        next.calls.set(current, { output: use.result, isRunning: use.result === undefined, isErrored: use.isError === true, isInterrupted: false })
      } else if (use.tool_use_id.startsWith(INNER_ROW) && current !== undefined) {
        next.codeOf.set(use.tool_use_id, current)
        next.lastInner.set(current, use.tool_use_id)
      }
    }
  }
  layout = next
  return next
}

/** The error text a row's output carries, or ''. */
const errorOf = (output: unknown) => (typeof output === 'object' && output !== null ? field(output, 'error') : '')

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

  // A folded group: each Code call's row above the group's own count line, with the value it
  // returned; the count line shows each error. Drawn only in the default view.
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (e.component !== 'ToolGroup' || e.props.isExpanded) return next(e)
    // A call Code Mode added for a tool a script called follows that script's call in the group.
    const rows: { call: (typeof e.props.calls)[number]; script: Script; trail: string[] }[] = []
    for (const call of e.props.calls) {
      const script = CODE_TOOLS.has(call.tool) ? scriptOf(call.input) : undefined
      if (script) rows.push({ call, script, trail: [] })
      else if (call.tool_use_id?.startsWith(INNER_ROW)) rows.at(-1)?.trail.push(trailLine(call.tool, call.input))
    }
    if (rows.length === 0) return next(e)
    const { background } = await known($, rows[0]?.call.tool_use_id ?? '')
    const table = $.ui.resolve(e)
    const { Box } = table
    return (
      <Box flexDirection="column">
        {rows.map(({ call, script, trail }) => codeRow(table, call, script, false, background, true, false, trail, undefined))}
        {await next(e)}
      </Box>
    )
  })

  // A call drawn as its own row: the engine draws Code Mode's script collapsed behind a click there.
  // A script that called no tool draws what it left under itself: its logs, then its value or error.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (e.component !== 'ToolUse') return next(e)
    const id = e.props.tool_use_id
    if (!CODE_TOOLS.has(e.props.tool) && !id.startsWith(INNER_ROW)) return next(e)
    const { placed, background } = await known($, id)
    const table = $.ui.resolve(e)
    if (id.startsWith(ERROR_ROW)) return drawnOnCall(errorOf(e.props.output), background) ? <table.Box /> : next(e)
    const whole = e.props.isExpanded === true
    if (CODE_TOOLS.has(e.props.tool)) {
      const script = scriptOf(e.props.input)
      if (script === undefined) return next(e)
      return codeRow(table, e.props, script, whole, background, !placed.lastInner.has(id), true, [], await foldFor($, e, whole))
    }
    return next(e)
  })

  // A result row of its own, which ctrl+o draws: under the last tool a script called goes the end of
  // that script's trail, with its logs. Claude Code's error line for a Code call is hidden, as the
  // call's own row or its trail shows it.
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (e.component !== 'ToolResult') return next(e)
    const id = e.props.tool_use_id
    if (!CODE_TOOLS.has(e.props.tool) && !id.startsWith(INNER_ROW)) return next(e)
    const { placed, background } = await known($, id)
    const table = $.ui.resolve(e)
    if (id.startsWith(ERROR_ROW)) return drawnOnCall(errorOf(e.props.output), background) ? <table.Box /> : next(e)
    const whole = e.props.isExpanded !== false
    if (id.startsWith(INNER_ROW)) return withOutcome(placed, table, id, background, await foldFor($, e, whole), true, next(e))
    return e.props.isErrored ? <table.Box /> : next(e)
  })
}
