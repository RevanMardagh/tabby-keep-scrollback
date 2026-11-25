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
}

export const DEFAULT_SETTINGS: KeepScrollbackSettings = {
    enabled: true,
    blockScrollbackClear: true,
    pushScreenOnClear: true,
}

/** Minimal slice of the xterm.js Terminal API we use (shared by @xterm/xterm and @xterm/headless). */
export interface XtermLike {
    readonly rows: number
    readonly buffer: {
        readonly active: {
            readonly type: 'normal' | 'alternate'
            readonly viewportY: number
            readonly baseY: number
            getLine (y: number): { translateToString (trimRight?: boolean): string } | undefined
        }
    }
    readonly parser: {
        registerCsiHandler (
            id: { prefix?: string, intermediates?: string, final: string },
            callback: (params: (number | number[])[]) => boolean | Promise<boolean>,
        ): { dispose (): void }
    }
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

/** Number of screen rows from the top up to and including the last non-empty one. */
export function usedRows (term: XtermLike): number {
    const buf = term.buffer.active
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
 * config changes apply live. Returns a disposer.
 */
export function installKeepScrollback (
    term: XtermLike,
    getSettings: () => KeepScrollbackSettings,
    logger?: Logger,
): { dispose (): void } {
    let internals: XtermInternals | null | undefined
    let warned = false

    const handler = term.parser.registerCsiHandler({ final: 'J' }, params => {
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
    })

    return handler
}
