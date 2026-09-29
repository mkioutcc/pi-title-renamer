# pi-title-renamer

`pi-title-renamer` is a Pi package that automatically renames the terminal tab after the first assistant reply in a session.

It is meant for people who keep several Pi sessions open and want each terminal tab to show the conversation topic instead of only the working directory. After a title has been applied, the extension also re-applies the last known title around Pi lifecycle events so Pi's default terminal-title updates are less likely to overwrite it.

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

If model generation fails, the fallback title first tries to derive a short topic from the first user message. If that is unavailable, it uses this shape:

```text
Pi｜project-name
```

## Settings inside Pi

Run `/title-renamer` to open the settings screen. Every option below can be changed there, and each change is saved right away.

- **↑ / ↓** move, **Enter** or **Space** changes the selected setting, **Esc** closes.
- On/off settings flip with one key press. Numbers and text open an inline editor that checks the value before saving.
- **Title model** opens a searchable list of the models Pi can use. You can also type any `provider/model-id`.
- **Interface language** switches the settings screen and all Title Renamer messages between English and 繁體中文. English is the default.
- **Save changes to** picks where changes are written: Global (`~/.pi/agent/title-renamer.json`) or Project (`<cwd>/.pi/title-renamer.json`). If a project file already exists, it is selected when the screen opens.
- **Reset to defaults** deletes the selected file after a second Enter to confirm.

Only the setting you change is written to the file. Other keys you added by hand are kept. If the file is not valid JSON, the screen refuses to overwrite it and shows an error instead.

In clients without the full terminal UI, such as RPC, the same settings are offered through simple pick and input dialogs.

## Commands

| Command | Description |
|---|---|
| `/title-renamer` | Open the settings screen. |
| `/rename-title --settings` | Same as `/title-renamer`. |
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

Manual `/rename-title <text>` titles are treated as user-owned and block automatic renaming until `/rename-title --reset` is used.

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
  "ui": {
    "language": "en"
  },
  "apply": {
    "terminalTitle": true,
    "sessionName": true,
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
  "generation": {
    "timeoutMs": 15000
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
| `ui.language` | string | `"en"` | Language of the settings screen and Title Renamer messages. Supported values: `"en"` and `"zh-TW"`. |
| `apply.terminalTitle` | boolean | `true` | Apply the generated title to the terminal window or tab. |
| `apply.sessionName` | boolean | `true` | Also set Pi's session name. |
| `apply.overwriteSessionName` | boolean | `false` | Allow automatic rename to overwrite an existing Pi session name when `apply.sessionName` is enabled. Manual `/rename-title <text>` can still update it. |
| `style.language` | string | `"en"` | Free-form language instruction sent to the model. This is not a fixed enum. |
| `style.maxChars` | number | `24` | Maximum title length in Unicode code points after sanitization. |
| `style.includeProject` | boolean | `true` | Ask for and normalize generated titles with the project name suffix, such as `topic｜project-name`. |
| `style.separator` | string | `"｜"` | Separator between topic and project name. |
| `input.includeFirstUserMessage` | boolean | `true` | Include the first user message in the title-generation prompt. |
| `input.includeFirstAssistantMessage` | boolean | `true` | Include the first assistant response in the title-generation prompt. |
| `input.includeCwd` | boolean | `true` | Include the current working directory in the title-generation prompt. |
| `input.includeModel` | boolean | `false` | Include the active model name in the title-generation prompt. |
| `generation.timeoutMs` | number | `15000` | Maximum time to wait for model title generation before falling back. |
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

`style.language` is a free-form language instruction sent to the model. The settings screen switches it between English (`en`) and Chinese (`zh-TW`). In the JSON file you can use any locale code or a plain-language description.

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

Terminal tab renaming and Pi session-name syncing are both enabled by default. Automatic renaming does not replace a session name that already exists unless `apply.overwriteSessionName` is on.

To also replace existing session names:

```json
{
  "apply": {
    "overwriteSessionName": true
  }
}
```

To keep the session name untouched:

```json
{
  "apply": {
    "sessionName": false
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
| Terminal tab still ignores title changes | Some terminals or shells can override OSC title updates. The extension re-applies the last known title around Pi lifecycle events, but it cannot read a title manually set outside Pi. | Try `/rename-title <text>` so the title is recorded, or check terminal/profile settings. |

## Development

Run tests from the package directory:

```bash
npm install
npm test
```

`test/settings.e2e.test.ts` drives the real settings screen with pi-tui keyboard input and writes every screen it visits to `test-artifacts/settings-e2e.txt`. The file is regenerated on each run and should not change unless the UI changes.

Pi loads TypeScript extensions directly, so this package ships source files under `extensions/` and has no build step.

## License

MIT
