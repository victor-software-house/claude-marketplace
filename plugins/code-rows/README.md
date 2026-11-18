# code-rows

Claude Code's Code Mode runs the model's work as one script per call, shown as `Code`.
The transcript folds those calls into a count line, and the ctrl+o view shows each script collapsed behind a click.  
In ctrl+o, code-rows draws each Code call the way Write draws a file it creates:  
a `Code(summary)` header, coloured by the call's state, and the script highlighted as JavaScript under it.  
The transcript's summaries stay as Claude Code draws them, so the work they fold away stays folded.

What the call returned (`→`) or threw (`✘`) draws where the script finished, in execution order:

- A script that called tools gets a row of its own after the last tool's result, naming the call, such as `⏺ Code(Count lines in demo.md) returned`.
- A script that called none shows its logs (`▸`), then its value or error, under the script.

In ctrl+o, each part of a long result shows its first 12 lines, and a click on its count line shows it whole.
Results come from the events in the session's messages, so a resumed session draws them too.

It needs no other plugin, setting or file, and draws on every surface Claude Code renders mods on.

## Install

At the prompt of a terminal session:

```text
/plugin install code-rows --marketplace victor-software-house/claude-marketplace
```

Answer `y` to add the marketplace, then pick a scope.

From a shell:

```sh
claude plugin install code-rows --marketplace victor-software-house/claude-marketplace
```

In the desktop app: click + next to the prompt box, then Plugins, Add marketplace with `victor-software-house/claude-marketplace`, then Add plugin.

## Test

```sh
claude plugin test plugins/code-rows
```
