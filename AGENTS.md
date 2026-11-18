# claude-marketplace

A public Claude Code plugin marketplace.
`.claude-plugin/marketplace.json` lists every plugin, and each plugin lives in `plugins/<name>/`.

## Rules

1. Each plugin folder holds `.claude-plugin/plugin.json`, its hooks or other parts, a `README.md` with an install section, and its tests.
2. Add a plugin to `.claude-plugin/marketplace.json` in the same change that adds its folder.
3. Before a commit, run `claude plugin validate plugins/<name>` and `claude plugin test plugins/<name>`.
4. A plugin's version starts at `0.0.1` and takes a patch bump for each release.
5. Plugins carry no secrets, internal hostnames, or names and data that belong to anyone else.
