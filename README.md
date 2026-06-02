# pi-title-renamer

`pi-title-renamer` is a Pi package that automatically gives each Pi terminal tab a short, readable title after the first assistant response in a session.

It is useful when you keep multiple Pi sessions open and want terminal tabs to reflect the actual conversation topic instead of only the working directory.

## Features

- Generates a concise terminal tab title after the first completed assistant response.
- Uses the active Pi model by default with `model: "inherit"`.
- Normalizes generated titles to the shape `topic｜project-name` when project names are enabled.
- Supports manual title changes with `/rename-title <text>`.
- Supports reset with `/rename-title --reset` so a later full turn can auto-rename again.
- Stores its own state as custom Pi session entries and does not inject that state into the LLM context.
- Has optional Pi session-name syncing through configuration.
- Uses no runtime dependencies beyond Pi peer packages.

## Requirements

- Pi coding agent with package support.
- A configured Pi model if you want model-generated titles.

If model generation fails, the extension falls back to a deterministic title such as `Pi｜project-name`.

## Install

After this package is published to npm:

```bash
pi install npm:pi-title-renamer
```

You can also install it from a Git repository:

```bash
pi install git:github.com/<user>/pi-title-renamer
```

For local development from this repository:

```bash
pi install ./pi-title-renamer
```

To try it for one run without installing it:

```bash
cd pi-title-renamer
pi -e ./extensions/title-renamer/index.ts
```

## Update or remove

Update installed Pi packages:

```bash
pi update --extensions
```

Update only this package after it is published to npm:

```bash
pi update npm:pi-title-renamer
```

Remove the npm package:

```bash
pi remove npm:pi-title-renamer
```

If you installed from a local path, run `pi list` and remove the exact source shown there.

## Default behavior

By default, the package:

- listens for the first `agent_end` that has a first user message and a first assistant message;
- uses `model: "inherit"`, meaning the active Pi model from `ctx.model`;
- asks the model for a single-line title;
- sanitizes the model output before use;
- normalizes model titles to use the project name as a suffix, for example `debug auth｜my-project`;
- calls `ctx.ui.setTitle(title)` in interactive UI mode;
- retries title application briefly to reduce terminal title race conditions;
- does not call `pi.setSessionName()` unless configured;
- appends a `title-renamer-state` custom entry so the same session is not automatically renamed again.

A title shaped like `topic｜project-name` is normal model output. A title shaped like `Pi｜project-name` is the default fallback.

## Commands

### `/rename-title`

Regenerate a title using the merged configuration and apply it. Manual regeneration ignores the automatic rename state.

### `/rename-title <text>`

Use `<text>` as the title without calling a model. The text is still sanitized and truncated according to `style.maxChars`.

Example:

```text
/rename-title Manual test title
```

### `/rename-title --show-config`

Show the current merged configuration, the two config paths, and any config warnings.

### `/rename-title --reset`

Append a reset state entry. This does not delete older custom entries and does not immediately rename the tab. It allows the next complete user-and-assistant turn to run automatic naming again.

## Configuration

Configuration is read from two JSON files. Project configuration overrides global configuration, and nested objects are merged structurally.

1. Global: `~/.pi/agent/title-renamer.json`
2. Project: `<cwd>/.pi/title-renamer.json`

On Windows, the global config path is typically:

```text
C:\Users\<you>\.pi\agent\title-renamer.json
```

The config file is not created automatically. Create it manually if you want to override defaults.

Default configuration:

```json
{
  "enabled": true,
  "auto": true,
  "trigger": "first-agent-end",
  "model": "inherit",
  "apply": {
    "terminalTitle": true,
    "sessionName": false,
    "overwriteSessionName": false
  },
  "style": {
    "language": "zh-TW",
    "maxChars": 24,
    "includeProject": true,
    "separator": "｜"
  },
  "input": {
    "includeFirstUserMessage": true,
    "includeFirstAssistantMessage": true,
    "includeCwd": true,
    "includeModel": false
  },
  "fallback": {
    "useProjectName": true,
    "prefix": "Pi"
  }
}
```

### Example: use an explicit model

```json
{
  "model": "caprouter/gpt-5.5"
}
```

`"inherit"` uses the current Pi model. A value shaped like `"provider/model-id"` resolves through Pi's model registry. Only the first slash separates provider from model id.

### Example: also rename the Pi session

```json
{
  "apply": {
    "terminalTitle": true,
    "sessionName": true,
    "overwriteSessionName": true
  }
}
```

When `apply.sessionName` is `true`, manual `/rename-title <text>` updates the Pi session name. Automatic rename only overwrites an existing session name when `apply.overwriteSessionName` is `true`.

### Example: disable project suffix

```json
{
  "style": {
    "includeProject": false
  },
  "fallback": {
    "useProjectName": false
  }
}
```

## Sanitization

Generated and manually supplied titles are sanitized before use:

- ANSI escape sequences are removed.
- Control characters are removed.
- Newlines are collapsed by selecting the first valid candidate.
- Wrapping quotes, backticks, code fences, and common Markdown markers are removed.
- Markdown links, bullets, headings, and numbered-list prefixes are stripped.
- The result is truncated to `style.maxChars` Unicode code points.

## Development

Run the unit tests from the package directory:

```bash
npm test
```

This package intentionally declares only Pi peer dependencies. Tests use Node built-ins and Node's native TypeScript type stripping.

## Publish checklist

Before publishing publicly:

1. Make sure `package.json` has the final package name, version, description, and `pi-package` keyword.
2. Run tests:

   ```bash
   npm test
   ```

3. Preview the npm tarball:

   ```bash
   npm pack --dry-run
   ```

4. Publish to npm:

   ```bash
   npm publish
   ```

5. After npm publish, users can install it with:

   ```bash
   pi install npm:pi-title-renamer
   ```

Pi's package gallery at `https://pi.dev/packages` discovers packages tagged with the `pi-package` keyword. You can add `pi.image` or `pi.video` metadata in `package.json` if you want a gallery preview.
