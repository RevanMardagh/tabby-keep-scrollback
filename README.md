# tabby-keep-scrollback

A [Tabby](https://tabby.sh/) plugin that makes `clear` behave like MobaXterm: the screen is
**pushed up into scrollback** instead of being erased, and programs can no longer wipe your
scrollback. Works in every terminal tab: local shells, SSH, serial, telnet.

## Why

`clear` sends `ESC[H ESC[2J ESC[3J`. Tabby's terminal engine (xterm.js) follows these literally:

- `ESC[2J` erases the visible screen without saving it to scrollback, so one screenful is lost.
- `ESC[3J` deletes the scrollback buffer, so everything is lost.

Shell-side fixes (`alias clear='clear -x'`, editing terminfo) only cover one shell on one host.
This plugin fixes it inside Tabby, for every session.

## What it does

| Sequence from the session | Behaviour |
|---|---|
| `ESC[3J` / `ESC[?3J` (erase scrollback) | Ignored |
| `ESC[2J` (erase screen), normal screen, cursor at top-left | Used rows are scrolled into scrollback, then the screen is erased |
| `ESC[2J` with the cursor elsewhere | Erased as normal (not pushed) |
| `ESC[2J` less than 1 s after the previous clear | Erased as normal (not pushed) |
| `ESC[2J` in the alternate screen (vim, less, htop…) | Erased as normal |
| `ESC c` (full reset, sent by `reset`) | Terminal is reset as normal, but scrollback is kept and the used screen rows are pushed into it |
| Partial erases (`ESC[J`, `ESC[1J`, `ESC[2K`…) | Unchanged |

The selective-erase forms (`ESC[?2J`, `ESC[?3J`) are handled the same as the plain ones,
because xterm.js runs the same erase for both.

Tabby's own **Clear terminal** hotkey still clears everything, scrollback included.

## Install

The plugin is not on npm yet. Build it, then install from the folder:

```powershell
npm install
npm run build
cd $env:APPDATA\tabby\plugins       # macOS: ~/Library/Application Support/tabby/plugins
npm install C:\path\to\tabby-keep-scrollback   # Linux: ~/.config/tabby/plugins
```

Restart Tabby completely (including the tray icon).

### Run from the project folder (development)

```powershell
# Quit Tabby first: it is single-instance, so a second launch ignores the variable.
$env:TABBY_PLUGINS = '\path\to\tabby-keep-scrollback'
& "$env:LOCALAPPDATA\Programs\Tabby\Tabby.exe" --debug
```

On Windows, give the path **without the drive letter**: Tabby splits `TABBY_PLUGINS` on `:`,
so `C:\...` breaks. A drive-less path resolves against the current drive.

Open DevTools with Ctrl+Shift+I. You should see `Found keep-scrollback in …` and
`Loading keep-scrollback: …`.

## Settings

In Tabby: Settings → **Keep scrollback**. Or edit `config.yaml` directly (Settings → Config file):

```yaml
keepScrollback:
  enabled: true                  # master switch
  blockScrollbackClear: true     # ignore ESC[3J from the session
  pushScreenOnClear: true        # push the screen into scrollback on ESC[2J
  onlyPushAfterCursorHome: true  # only push when the cursor is at the top-left (what `clear` does)
  minPushIntervalMs: 1000        # skip a push if the previous clear was this recent; 0 = no limit
  keepScrollbackOnReset: true    # ESC c (reset) keeps the scrollback
```

Changes apply immediately, no restart needed.

### Which clears get pushed

`onlyPushAfterCursorHome` and `minPushIntervalMs` stop tools that redraw the screen with
`ESC[2J` from filling the scrollback with copies of every frame:

- `clear`, Ctrl+L in bash/zsh, `os.system('clear')`: these move the cursor home, then erase. **Pushed.**
- Tools that erase with the cursor mid-screen: **not pushed**.
- Redraw loops (move home, erase, draw, repeat): the first frame's *previous* screen is pushed,
  then nothing while the loop keeps redrawing faster than once per `minPushIntervalMs`.
  The timer slides: each qualifying clear restarts it.
- Scripts that erase **then** move home (`printf '\e[2J\e[H'`): **not pushed**, so that screen is
  lost as it would be without the plugin. Set `onlyPushAfterCursorHome: false` if you rely on these.
- Running `clear` twice within a second: the second one is not pushed, so whatever was printed
  between the two is lost.

## Known limitations

- **tmux / screen:** inside a multiplexer, the scrollback you see is the multiplexer's, not Tabby's.
- **`reset` (`ESC c`):** the terminal is still fully reset (modes, colours, character sets, tab
  stops); only the scrollback and the shell screen are kept. If it arrives while a full-screen
  program's alternate screen is showing (e.g. `:!reset` in vim), that program's screen is dropped,
  not pushed. Turn off `keepScrollbackOnReset` for the stock behaviour (everything wiped).
- **Windows `cls`:** Windows' console layer (ConPTY) decides which sequences are sent. If it erases
  without moving the cursor home first, `cls` won't be pushed; set `onlyPushAfterCursorHome: false`.
- The push uses non-public xterm.js internals (`_core._bufferService`), the same kind of
  access Tabby's built-in image addon relies on. If a future Tabby/xterm.js update removes them, the
  plugin logs a warning in DevTools and still blocks `ESC[3J`; clears then lose one screen and `reset`
  wipes scrollback, as stock Tabby does.

## How it works

The plugin registers a handler for `CSI … J` with xterm.js's own parser
(`term.parser.registerCsiHandler`) on every terminal tab, via a Tabby `TerminalDecorator`.
The handler runs at the exact point the sequence is parsed, so it sees the real buffer state:
which screen is active, where the cursor is, and how many rows are in use (only those are
pushed, so no blank lines are added to the scrollback). xterm.js reassembles sequences split
across chunks before calling the handler.

For `ESC c` it registers an ESC handler that saves the scrollback lines, lets xterm.js do its
real full reset (so modes, colours, charsets and the alternate screen are reset exactly as before),
then puts the saved lines back above the fresh screen.

Filtering the byte stream before it reaches xterm.js (a Tabby `SessionMiddleware`) was rejected:
Tabby writes to xterm.js asynchronously, so a middleware sees stale screen state.

## Development

```powershell
npm install
npm test           # unit tests against the real xterm.js (@xterm/headless)
npm run typecheck
npm run build      # dist/index.js
```

Layout:

- `src/keepScrollback.ts`: all the logic, no Tabby imports
- `src/decorator.ts`: installs the handler on each tab's xterm.js and reads settings
- `src/config.ts`: default settings
- `src/settings.ts`: the Settings → Keep scrollback tab
- `src/index.ts`: the Angular module Tabby loads
- `src/tabby.d.ts`: minimal type declarations for the Tabby APIs used (Tabby provides them at runtime)

Tabby's plugin loader requires an `author` field in `package.json`; without it the plugin
fails with "Cannot load package info".

## License

Copyright (C) 2026 RevanMardagh

This program is free software: you can redistribute it and/or modify it under the terms of the
GNU General Public License as published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version. It is distributed WITHOUT ANY WARRANTY. See
[LICENSE](LICENSE) for the full text.
