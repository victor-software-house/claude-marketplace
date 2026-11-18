# code-rows

Claude Code's Code Mode runs the model's work as one script per call, shown as `Code`.
The transcript folds those calls into a count line, and the ctrl+o view shows each script collapsed behind a click.
code-rows draws each Code call the way Write draws a file it creates:  
a `Code(summary)` header, coloured by the call's state, and the script highlighted as JavaScript under it.

- In the transcript, the first six lines, then `… +N lines (ctrl+o to expand)`.
- Under ctrl+o or `--verbose`, the whole script.

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
