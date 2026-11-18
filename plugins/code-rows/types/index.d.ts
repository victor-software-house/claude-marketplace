/** What a script run in the background settled to, from its repl-eval event; `logs` absent on one kept before logs were. */
export type Settled = { logs?: string; value: string; error: string }

declare module 'claude-code' {
  interface PluginState {
    'code-rows': {
      settled: Record<string, Settled>
      /** Whether a row drawn in full shows each part of its result whole, as a click on its count line asks. */
      shown: StateFamily<boolean>
    }
  }
}
