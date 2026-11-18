import type { On } from 'claude-code'
import { expect, test, type Engine } from 'claude-code/testing'

/** A Code call's script of `n` numbered lines. */
const script = (n: number) => Array.from({ length: n }, (_, i) => `const line${i + 1} = ${i + 1};`).join('\n')
const call = (code: string) => ({
  tool_use_id: 'tu1',
  tool: 'REPL',
  input: { code, description: 'Count the lines' },
  isRunning: false,
  isErrored: false,
  isInterrupted: false,
})

/** Stands in for the engine's own drawing beneath the plugin. */
function engine(on: On) {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  on('prompt.attachment', ($, e) => ({ text: e.text }))
}

/** A poll_events attachment carrying repl-eval events, as the engine sends them to the model. */
const events = (...bodies: [number, string][]) =>
  bodies.map(([id, body]) => `<event nonce="n${id}" kind="repl-eval" at="2026-11-18T13:00:11.073Z" eval="${id}" ms="26" status="settled">\n${body}\n</event>`).join('\n')

const dispatched = (id: number) => ({ code: script(2), result: `(dispatched #${id})`, stdout: '', stderr: '', evalId: id, asyncDispatched: true })

const mountGroup = ($: Engine, code: string) =>
  $.ui.mount({
    plugin: 'code-rows',
    surface: 'terminal',
    component: 'ToolGroup',
    props: { calls: [call(code)], isActive: false, isExpanded: false },
  })

const mountRow = ($: Engine, surface: 'terminal' | 'desktop', code: string, isExpanded: boolean) =>
  $.ui.mount({
    plugin: 'code-rows',
    surface,
    component: 'ToolUse',
    props: { ...call(code), isExpanded },
  })

test('a folded group draws the Code call above its own line, cut to six lines', async ($, on) => {
  engine(on)
  const ui = await mountGroup($, script(10))
  expect((await ui.find({ type: 'Text', text: /^Code\(Count the lines\)$/ }))?.text).toBeTruthy()
  const code = await ui.find({ type: 'Code' })
  expect(code?.text).toContain('const line6 = 6;')
  expect(code?.text).not.toContain('const line7')
  expect((await ui.find({ type: 'Text', text: '… +4 lines (ctrl+o to expand)' }))?.text).toBeTruthy()
  expect((await ui.find({ type: 'Text', text: 'engine' }))?.text).toBeTruthy()
  await ui.unmount()
})

test('a short script draws whole with no count line', async ($, on) => {
  engine(on)
  const ui = await mountGroup($, script(3))
  expect((await ui.find({ type: 'Code' }))?.text).toContain('const line3 = 3;')
  expect(await ui.find({ type: 'Text', text: /lines \(ctrl\+o to expand\)/ })).toBeUndefined()
  await ui.unmount()
})

test('a row drawn in full shows the whole script on every surface', async ($, on) => {
  engine(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await mountRow($, surface, script(10), true)
    expect((await ui.find({ type: 'Code' }))?.text).toContain('const line10 = 10;')
    expect(await ui.find({ type: 'Text', text: /ctrl\+o to expand/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('a finished call draws its logs and its value under the script, marked apart', async ($, on) => {
  engine(on)
  const output = { code: script(2), result: '{ lines: 18 }', stdout: 'reading', stderr: '' }
  const ui = await $.ui.mount({ plugin: 'code-rows', surface: 'terminal', component: 'ToolUse', props: { ...call(script(2)), isExpanded: false, output } })
  expect((await ui.find({ type: 'Text', text: 'reading' }))?.text).toBeTruthy()
  expect((await ui.find({ type: 'Text', text: /▸/ }))?.text).toBeTruthy()
  expect((await ui.findAll({ type: 'Code' })).map(found => found.text)).toEqual([script(2), '{ lines: 18 }'])
  await ui.unmount()
})

test('a failed call draws its error under its own script, and Claude Code’s line for it is hidden', async ($, on) => {
  engine(on)
  const output = { code: script(2), result: null, stdout: '', stderr: '', error: 'Error: boom\nThrown at line 2' }
  const ui = await $.ui.mount({ plugin: 'code-rows', surface: 'terminal', component: 'ToolUse', props: { ...call(script(2)), isErrored: true, isExpanded: true, output } })
  expect((await ui.find({ type: 'Text', text: 'Error: boom' }))?.text).toBeTruthy()
  expect((await ui.find({ type: 'Text', text: 'Thrown at line 2' }))?.text).toBeTruthy()
  await ui.unmount()
  const line = await $.ui.mount({ plugin: 'code-rows', surface: 'terminal', component: 'ToolResult', props: { tool_use_id: 'tu1', tool: 'REPL', output, isErrored: true, isExpanded: true } })
  expect(await line.find({ type: 'Text', text: 'engine' })).toBeUndefined()
  await line.unmount()
})

test('a background call waits for its event, then draws what it left and hides Claude Code’s floating error row', async ($, on) => {
  engine(on)
  const mount = (id: number) =>
    $.ui.mount({ plugin: 'code-rows', surface: 'terminal', component: 'ToolUse', props: { ...call(script(2)), tool_use_id: `tu${id}`, isExpanded: true, output: dispatched(id) } })
  const before = await mount(7)
  expect((await before.find({ type: 'Text', text: 'running in the background' }))?.text).toBeTruthy()
  await before.unmount()

  const text = events([7, '<log>about to fail</log>\n<error>Error: boom: demo failure\nThrown at (statements quoted)</error>'], [8, '<result>{ n: 1 }</result>'])
  expect(await $.prompt.attachment({ type: 'poll_events', text, origin: { kind: 'engine' } })).toEqual({ text })

  const failed = await mount(7)
  expect(await failed.find({ type: 'Text', text: 'running in the background' })).toBeUndefined()
  expect((await failed.find({ type: 'Text', text: 'about to fail' }))?.text).toBeTruthy()
  expect((await failed.find({ type: 'Text', text: 'Error: boom: demo failure' }))?.text).toBeTruthy()
  await failed.unmount()
  const worked = await mount(8)
  expect((await worked.findAll({ type: 'Code' })).map(found => found.text)).toEqual([script(2), '{ n: 1 }'])
  await worked.unmount()

  const row = (error: string) =>
    $.ui.mount({ plugin: 'code-rows', surface: 'terminal', component: 'ToolResult', props: { tool_use_id: 'repl-error-1', tool: 'REPL', output: { error }, isErrored: true, isExpanded: true } })
  const hidden = await row('Error: boom: demo failure')
  expect(await hidden.find({ type: 'Text', text: 'engine' })).toBeUndefined()
  await hidden.unmount()
  const unknown = await row('Error: something this mod never saw')
  expect((await unknown.find({ type: 'Text', text: 'engine' }))?.text).toBeTruthy()
  await unknown.unmount()
})

test('a group without a Code call is left to the engine', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({
    plugin: 'code-rows',
    surface: 'terminal',
    component: 'ToolGroup',
    props: { calls: [{ ...call(''), tool: 'Read', input: { file_path: '/x' } }], isActive: false, isExpanded: false },
  })
  expect(await ui.find({ type: 'Code' })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: 'engine' }))?.text).toBeTruthy()
  await ui.unmount()
})
