/**
 * Core logic: hooks xterm.js's own parser so clear sequences are handled at the exact
 * point they are parsed, with the real buffer state. No Tabby/Angular imports, so it
 * can be tested against @xterm/headless in plain Node.
 */

export interface KeepScrollbackSettings {
    enabled: boolean
    /** Drop ESC[3J (erase scrollback) coming from the session. */
    blockScrollbackClear: boolean
    /** On ESC[2J in the normal buffer, scroll the used part of the screen into scrollback first. */
    pushScreenOnClear: boolean
    /**
     * Only push when the cursor is at the top-left when ESC[2J arrives, which is what
     * `clear` does (ESC[H ESC[2J). Erases issued mid-screen by redrawing tools are not pushed.
     */
    onlyPushAfterCursorHome: boolean
    /**
     * Skip the push if the previous qualifying ESC[2J came less than this many ms ago,
     * so redraw loops don't flood the scrollback. 0 disables the limit.
     */
    minPushIntervalMs: number
    /**
     * On ESC c (RIS, sent by `reset`), keep the scrollback: xterm.js's full reset still runs,
     * then the old scrollback (plus the used screen rows if pushScreenOnClear) is put back above
     * the fresh screen.
     */
    keepScrollbackOnReset: boolean
}

export const DEFAULT_SETTINGS: KeepScrollbackSettings = {
    enabled: true,
    blockScrollbackClear: true,
    pushScreenOnClear: true,
    onlyPushAfterCursorHome: true,
    minPushIntervalMs: 1000,
    keepScrollbackOnReset: true,
}

export interface BufferLike {
    readonly type: 'normal' | 'alternate'
    readonly cursorX: number
    readonly cursorY: number
    readonly viewportY: number
    readonly baseY: number
    getLine (y: number): { translateToString (trimRight?: boolean): string } | undefined
}

/** Minimal slice of the xterm.js Terminal API we use (shared by @xterm/xterm and @xterm/headless). */
export interface XtermLike {
    readonly rows: number
    readonly buffer: {
        readonly active: BufferLike
        readonly normal: BufferLike
    }
    readonly parser: {
        registerCsiHandler (
            id: { prefix?: string, intermediates?: string, final: string },
            callback: (params: (number | number[])[]) => boolean | Promise<boolean>,
        ): { dispose (): void }
        registerEscHandler (
            id: { intermediates?: string, final: string },
            callback: () => boolean | Promise<boolean>,
        ): { dispose (): void }
    }
    reset (): void
    scrollToBottom (): void
}

export interface Logger {
    warn (...args: any[]): void
}

/** Internal xterm.js pieces needed to push lines into scrollback. */
interface XtermInternals {
    scroll (): void
    scrollTop: number
    scrollBottom: number
}

function getInternals (term: any): XtermInternals | null {
    const core = term?._core
    const bufferService = core?._bufferService
    const inputHandler = core?._inputHandler
    if (
        typeof bufferService?.scroll !== 'function' ||
        typeof inputHandler?._eraseAttrData !== 'function' ||
        !bufferService.buffer
    ) {
        return null
    }
    return {
        scroll: () => bufferService.scroll(inputHandler._eraseAttrData()),
        get scrollTop () { return bufferService.buffer.scrollTop },
        get scrollBottom () { return bufferService.buffer.scrollBottom },
    }
}

/** Internal xterm.js `CircularList` of `BufferLine`s, the storage behind a buffer. */
interface LineList {
    length: number
    readonly maxLength: number
    get (index: number): unknown
    push (line: unknown): void
}

/** Internal xterm.js `Buffer`, enough to rebuild its line list. */
interface BufferInternals {
    lines: LineList
    ybase: number
    ydisp: number
}

/**
 * The normal buffer's internals. Looked up on each call: a full reset replaces the
 * Buffer objects, so a cached reference would point at the discarded one.
 */
function getNormalBuffer (term: any): BufferInternals | null {
    const buf = term?._core?._bufferService?.buffers?.normal
    const lines = buf?.lines
    if (
        !lines ||
        typeof lines.get !== 'function' ||
        typeof lines.push !== 'function' ||
        typeof lines.maxLength !== 'number' ||
        typeof buf.ybase !== 'number'
    ) {
        return null
    }
    return buf
}

/** Number of screen rows from the top up to and including the last non-empty one. */
export function usedRows (term: XtermLike, buf: BufferLike = term.buffer.active): number {
    for (let y = term.rows - 1; y >= 0; y--) {
        const line = buf.getLine(buf.baseY + y)
        if (line && line.translateToString(true).length > 0) {
            return y + 1
        }
    }
    return 0
}

function firstParam (params: (number | number[])[]): number {
    const p = params[0]
    if (Array.isArray(p)) {
        return p[0] ?? 0
    }
    return p ?? 0
}

/**
 * Install the clear handlers on a terminal. `getSettings` is read on every sequence so
 * config changes apply live. `now` is injectable for tests. Returns a disposer.
 */
export function installKeepScrollback (
    term: XtermLike,
    getSettings: () => KeepScrollbackSettings,
    logger?: Logger,
    now: () => number = Date.now,
): { dispose (): void } {
    let internals: XtermInternals | null | undefined
    let warned = false
    let lastClearAt: number | undefined

    const onEraseInDisplay = (params: (number | number[])[]): boolean => {
        const settings = getSettings()
        if (!settings.enabled) {
            return false
        }
        const mode = firstParam(params)

        if (mode === 3) {
            // true = handled: xterm.js skips its default (scrollback wipe)
            return settings.blockScrollbackClear
        }

        if (mode === 2 && settings.pushScreenOnClear && term.buffer.active.type === 'normal') {
            const buf = term.buffer.active
            if (settings.onlyPushAfterCursorHome && (buf.cursorX !== 0 || buf.cursorY !== 0)) {
                return false
            }
            // Sliding window: every qualifying clear resets the timer, so a redraw loop
            // gets its first frame pushed and nothing more while it keeps redrawing.
            const t = now()
            const tooSoon = settings.minPushIntervalMs > 0 &&
                lastClearAt !== undefined &&
                t - lastClearAt < settings.minPushIntervalMs
            lastClearAt = t
            if (tooSoon) {
                return false
            }
            if (internals === undefined) {
                internals = getInternals(term)
            }
            if (!internals) {
                if (!warned) {
                    warned = true
                    logger?.warn('tabby-keep-scrollback: xterm.js internals not found, cannot push screen into scrollback (ESC[3J blocking still works)')
                }
                return false
            }
            // With a restricted scroll region (DECSTBM), scrolled lines don't go to scrollback.
            if (internals.scrollTop === 0 && internals.scrollBottom === term.rows - 1) {
                const n = usedRows(term)
                for (let i = 0; i < n; i++) {
                    internals.scroll()
                }
            }
        }

        // let xterm.js run its normal handling (erases the now-empty screen)
        return false
    }

    let warnedReset = false

    /**
     * RIS (ESC c). xterm.js's full reset rebuilds both buffers, losing the scrollback.
     * Rather than re-implement everything RIS resets (modes, charsets, colours, tab stops,
     * alt screen...), run the real reset and then put the saved lines back.
     */
    const onReset = (): boolean => {
        const settings = getSettings()
        if (!settings.enabled || !settings.keepScrollbackOnReset) {
            return false
        }
        const old = getNormalBuffer(term)
        if (!old) {
            if (!warnedReset) {
                warnedReset = true
                logger?.warn('tabby-keep-scrollback: xterm.js internals not found, reset (ESC c) will wipe scrollback')
            }
            return false
        }

        // The normal buffer even when the alternate screen is active: RIS returns to it,
        // and its screen is what the user had before e.g. starting vim.
        const keep = old.ybase + (settings.pushScreenOnClear ? usedRows(term, term.buffer.normal) : 0)
        const saved: unknown[] = []
        for (let i = 0; i < keep; i++) {
            saved.push(old.lines.get(i))
        }

        term.reset()

        const buf = getNormalBuffer(term)
        if (!buf) {
            return true // can't happen if it existed before the reset; nothing more to do
        }
        const screen: unknown[] = []
        for (let i = 0; i < buf.lines.length; i++) {
            screen.push(buf.lines.get(i))
        }
        // Rebuild with plain pushes. CircularList.splice() corrupts the newest entries when
        // an insert overflows maxLength, so trim the oldest saved lines up front instead.
        const room = buf.lines.maxLength - screen.length
        const restore = saved.length > room ? saved.slice(saved.length - room) : saved
        buf.lines.length = 0
        for (const line of restore) {
            buf.lines.push(line)
        }
        for (const line of screen) {
            buf.lines.push(line)
        }
        buf.ybase = restore.length
        // scrollToBottom() fires the scroll event so the viewport picks up the new height
        buf.ydisp = 0
        term.scrollToBottom()
        ;(term as any).refresh?.(0, term.rows - 1)
        return true
    }

    // ED (CSI J) and DECSED (CSI ? J): xterm.js runs the same erase for both, including
    // the scrollback wipe on mode 3, so both need the same handling.
    const handlers = [
        term.parser.registerCsiHandler({ final: 'J' }, onEraseInDisplay),
        term.parser.registerCsiHandler({ prefix: '?', final: 'J' }, onEraseInDisplay),
        term.parser.registerEscHandler({ final: 'c' }, onReset),
    ]

    return {
        dispose: () => handlers.forEach(h => h.dispose()),
    }
}
