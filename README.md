# pi-title-renamer

`pi-title-renamer` is a Pi package that automatically renames the terminal tab after the first assistant reply in a session.

It is meant for people who keep several Pi sessions open and want each terminal tab to show the conversation topic instead of only the working directory.

Repository: <https://github.com/mkioutcc/pi-title-renamer>

## Install

```bash
pi install npm:pi-title-renamer
```

Restart Pi after installing. The next new conversation will be renamed after the first assistant response completes.

To try the package from a local checkout:

```bash
pi install ./pi-title-renamer
```

To run it once without installing:

```bash
cd pi-title-renamer
pi -e ./extensions/title-renamer/index.ts
```

## Usage

Start Pi normally and send your first message. After the first assistant response finishes, the extension asks the active Pi model for a short title and applies it to the terminal tab.

Generated titles are normalized to this shape by default:

```text
topic｜project-name
```

For example:

```text
Auth Debugging｜my-app
```

If model generation fails, the fallback title uses this shape:

```text
Pi｜project-name
```

## Commands

| Command | Description |
|---|---|
| `/rename-title` | Generate a new title with the configured model and apply it immediately. |
| `/rename-title <text>` | Use the provided text as the title without calling a model. |
| `/rename-title --show-config` | Show the merged config, config paths, and config warnings. |
| `/rename-title --reset` | Allow the next complete user-and-assistant turn to auto-rename again. |

Examples:

```text
/rename-title Manual test title
```

```text
/rename-title --reset
```

`--reset` does not rename immediately. It only clears the automatic rename state so the next full turn can generate a new title.

## Configuration

Configuration is optional. If no config file exists, defaults are used.

Config is loaded from two places:

1. Global config: `~/.pi/agent/title-renamer.json`
2. Project config: `<cwd>/.pi/title-renamer.json`

Project config overrides global config. Nested objects are merged.

On Windows, the global path is usually:

```text
C:\Users\<you>\.pi\agent\title-renamer.json
```

Default config:

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
    "language": "en",
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

### Configuration fields

| Field | Type | Default | Description |
|---|---:|---|---|
| `enabled` | boolean | `true` | Enables automatic title renaming. Manual commands remain available for changing titles and inspecting config. |
| `auto` | boolean | `true` | Runs automatic renaming after the configured trigger. Set to `false` if you only want manual `/rename-title` commands. |
| `trigger` | string | `"first-agent-end"` | Automatic rename timing. Currently the only supported value is `"first-agent-end"`, meaning after the first assistant response completes. Unsupported values fall back to the default and show a config warning. |
| `model` | string | `"inherit"` | Model used to generate titles. Use `"inherit"` for the active Pi model or `"provider/model-id"` for a specific model. |
| `apply.terminalTitle` | boolean | `true` | Apply the generated title to the terminal window or tab. |
| `apply.sessionName` | boolean | `false` | Also set Pi's session name. |
| `apply.overwriteSessionName` | boolean | `false` | Allow automatic rename to overwrite an existing Pi session name when `apply.sessionName` is enabled. Manual `/rename-title <text>` can still update it. |
| `style.language` | string | `"en"` | Free-form language instruction sent to the model. This is not a fixed enum. |
| `style.maxChars` | number | `24` | Maximum title length in Unicode code points after sanitization. |
| `style.includeProject` | boolean | `true` | Ask for and normalize generated titles with the project name suffix, such as `topic｜project-name`. |
| `style.separator` | string | `"｜"` | Separator between topic and project name. |
| `input.includeFirstUserMessage` | boolean | `true` | Include the first user message in the title-generation prompt. |
| `input.includeFirstAssistantMessage` | boolean | `true` | Include the first assistant response in the title-generation prompt. |
| `input.includeCwd` | boolean | `true` | Include the current working directory in the title-generation prompt. |
| `input.includeModel` | boolean | `false` | Include the active model name in the title-generation prompt. |
| `fallback.useProjectName` | boolean | `true` | Include the project name in fallback titles. |
| `fallback.prefix` | string | `"Pi"` | Prefix used when fallback is needed. With defaults, fallback looks like `Pi｜project-name`. |

### Automatic rename timing

`trigger` currently supports one value:

```json
{ "trigger": "first-agent-end" }
```

This means the extension waits until the first user message has received its first assistant response, then generates and applies a title once.

To turn off automatic rename but keep manual commands:

```json
{
  "auto": false
}
```

### Title language

`style.language` is a free-form language instruction sent to the model. You can use a locale code or a plain-language description.

Common examples:

```json
{ "style": { "language": "en" } }
```

```json
{ "style": { "language": "zh-TW" } }
```

```json
{ "style": { "language": "繁體中文，簡短自然" } }
```

The default is `"en"`.

### Use a specific model

By default, `model` is `"inherit"`, which means the extension uses the active Pi model.

To use a specific model:

```json
{
  "model": "provider/model-id"
}
```

Only the first slash separates provider from model id. For example, `openrouter/anthropic/claude-sonnet` means:

- provider: `openrouter`
- model id: `anthropic/claude-sonnet`

### Also rename the Pi session

Terminal tab renaming is enabled by default. Pi session-name syncing is disabled by default.

To enable both:

```json
{
  "apply": {
    "terminalTitle": true,
    "sessionName": true,
    "overwriteSessionName": true
  }
}
```

### Disable project suffix

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

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Title does not change after installing | The current Pi process has not loaded the package yet. | Restart Pi or run `/reload`. |
| `/rename-title --reset` does not change the title immediately | Reset only clears auto-rename state. | Send a new message and wait for the assistant reply to finish. |
| Title is `Pi｜project-name` | Model generation failed and fallback was used. | Check model credentials or run `/rename-title --show-config`. |
| Manual title is truncated | `style.maxChars` limits title length. | Increase `style.maxChars` in config. |
| Terminal tab still ignores title changes | Some terminals or shells can override OSC title updates. | Try another terminal or check terminal title/profile settings. |

## Development

Run tests from the package directory:

```bash
npm test
```

Pi loads TypeScript extensions directly, so this package ships source files under `extensions/` and has no build step.

## License

MIT
