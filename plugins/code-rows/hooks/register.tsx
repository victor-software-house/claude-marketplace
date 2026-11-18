import type { ElementTable, Register, RenderElement } from 'claude-code'

// Code Mode's tool (REPL, shown as Code) draws its script only in the ctrl+o
// transcript, behind a click, and the transcript folds the call into a group's
// count line. This draws each Code call as Write draws a file: a Code(summary)
// header, then the script highlighted under it, the first PREVIEW lines in the
// transcript and all of it where rows are drawn in full (ctrl+o, --verbose).
// Results stay Claude Code's: it draws no value for a Code call, and an error
// as its own line, under the group's count line or under the call in ctrl+o.

const PREVIEW = 6
const CODE_TOOLS = new Set(['REPL', 'Eval'])

type Script = { code: string; summary: string }
type Call = { input: unknown; output?: unknown; isRunning: boolean; isErrored: boolean; isInterrupted: boolean }

/** The call's script and the summary its header shows: the description, else the first line. */
const scriptOf = (input: unknown): Script | undefined => {
  if (typeof input !== 'object' || input === null || !('code' in input)) return undefined
  const code = typeof input.code === 'string' ? input.code.replace(/\s+$/, '') : ''
  if (code.trim() === '') return undefined
  const description = 'description' in input && typeof input.description === 'string' ? input.description.trim() : ''
  return { code, summary: description || (code.split('\n').find(line => line.trim() !== '') ?? '').trim() }
}

/** `lines` cut to `limit` unless `whole`, with the count of those left out. */
const cut = (lines: string[], limit: number, whole: boolean) => {
  const shown = whole ? lines : lines.slice(0, limit)
  return { shown, hidden: lines.length - shown.length }
}

/**
 * The dot's colour, as Claude Code's own Code row sets it: grey while the call runs, and for a call
 * dispatched to the background, which answers at once and settles later; red for one that failed.
 */
const dotOf = (call: Call) => {
  const dispatched = typeof call.output === 'object' && call.output !== null && 'asyncDispatched' in call.output && call.output.asyncDispatched === true
  if (call.isRunning || dispatched) return 'inactive'
  return call.isErrored || call.isInterrupted ? 'error' : 'success'
}

/** A Code call's row: its header with the dot in the call's state, and its script, cut to PREVIEW lines unless `whole`. */
function codeRow({ Box, Text, Code }: Pick<ElementTable, 'Box' | 'Text' | 'Code'>, call: Call, script: Script, whole: boolean): RenderElement {
  const { shown, hidden } = cut(script.code.split('\n'), PREVIEW, whole)
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box flexDirection="row">
        <Text color={dotOf(call)}>{'⏺ '}</Text>
        <Text wrap="truncate-end">
          <Text bold>Code</Text>
          {`(${script.summary})`}
        </Text>
      </Box>
      <Box flexDirection="row">
        <Text dimColor>{'  ⎿  '}</Text>
        <Box flexDirection="column" flexGrow={1}>
          <Code source={shown.join('\n')} language="javascript" />
          {hidden > 0 && <Text dimColor>{`… +${hidden} lines (ctrl+o to expand)`}</Text>}
        </Box>
      </Box>
    </Box>
  )
}

export const register: Register = on => {
  // A folded group: each Code call's row above the group's own count line.
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (e.component !== 'ToolGroup' || e.props.isExpanded) return next(e)
    const rows = e.props.calls.flatMap(call => {
      const script = CODE_TOOLS.has(call.tool) ? scriptOf(call.input) : undefined
      return script ? [{ call, script }] : []
    })
    if (rows.length === 0) return next(e)
    const table = $.ui.resolve(e)
    const { Box } = table
    return (
      <Box flexDirection="column">
        {rows.map(({ call, script }) => codeRow(table, call, script, false))}
        {await next(e)}
      </Box>
    )
  })

  // A call drawn as its own row: the engine draws Code Mode's script collapsed behind a click there.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (e.component !== 'ToolUse' || !CODE_TOOLS.has(e.props.tool)) return next(e)
    const script = scriptOf(e.props.input)
    if (script === undefined) return next(e)
    return codeRow($.ui.resolve(e), e.props, script, e.props.isExpanded === true)
  })
}
