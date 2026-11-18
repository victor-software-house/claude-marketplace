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
}

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

test('results stay the engine’s: no value, dispatch note or error text under the script', async ($, on) => {
  engine(on)
  const outputs = [
    { isErrored: false, output: { code: script(2), result: '{ lines: 18 }', stdout: 'reading', stderr: '' } },
    { isErrored: false, output: { code: script(2), result: '(dispatched #1)', stdout: '', stderr: '', evalId: 1, asyncDispatched: true } },
    { isErrored: true, output: { code: script(2), result: null, stdout: '', stderr: '', error: 'Error: boom' } },
  ]
  for (const { isErrored, output } of outputs) {
    const ui = await $.ui.mount({
      plugin: 'code-rows',
      surface: 'terminal',
      component: 'ToolUse',
      props: { ...call(script(2)), isErrored, isExpanded: true, output },
    })
    for (const text of [/lines: 18/, /reading/, /dispatched/, /boom/]) expect(await ui.find({ type: 'Text', text })).toBeUndefined()
    expect((await ui.findAll({ type: 'Code' })).map(found => found.text)).toEqual([script(2)])
    await ui.unmount()
  }
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
