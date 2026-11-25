import { describe, it, expect } from 'vitest'
import { Terminal } from '@xterm/headless'
import { installKeepScrollback, DEFAULT_SETTINGS, KeepScrollbackSettings, usedRows } from '../src/keepScrollback'

const ROWS = 10
const COLS = 40
const CLEAR = '\x1b[H\x1b[2J\x1b[3J' // what ncurses `clear` sends

/**
 * Default clock jumps 10 s per call, so tests not about rate limiting never trip it
 * while still running with the default settings.
 */
function makeTerm (
    settings: Partial<KeepScrollbackSettings> = {},
    logger?: { warn: (...a: any[]) => void },
    now?: () => number,
) {
    let t = 0
    const term = new Terminal({ rows: ROWS, cols: COLS, scrollback: 1000, allowProposedApi: true })
    const s = { ...DEFAULT_SETTINGS, ...settings }
    installKeepScrollback(term as any, () => s, logger, now ?? (() => (t += 10_000)))
    return { term, s }
}

function write (term: Terminal, data: string): Promise<void> {
    return new Promise(resolve => term.write(data, resolve))
}

/** All lines in the buffer (scrollback + screen), right-trimmed. */
function allLines (term: Terminal): string[] {
    const buf = term.buffer.active
    const out: string[] = []
    for (let i = 0; i < buf.length; i++) {
        out.push(buf.getLine(i)!.translateToString(true))
    }
    return out
}

function screenLines (term: Terminal): string[] {
    const buf = term.buffer.active
    const out: string[] = []
    for (let y = 0; y < term.rows; y++) {
        out.push(buf.getLine(buf.baseY + y)!.translateToString(true))
    }
    return out
}

function seq (from: number, to: number): string {
    const lines: string[] = []
    for (let i = from; i <= to; i++) {
        lines.push(String(i))
    }
    return lines.join('\r\n')
}

function nonEmpty (lines: string[]): string[] {
    return lines.filter(l => l.length > 0)
}

describe('keepScrollback', () => {
    it('stock xterm.js loses everything on clear (sanity check of the problem)', async () => {
        const term = new Terminal({ rows: ROWS, cols: COLS, scrollback: 1000, allowProposedApi: true })
        await write(term, seq(1, 50))
        await write(term, CLEAR)
        expect(nonEmpty(allLines(term))).toEqual([])
    })

    it('clear keeps every line, including the ones that were visible', async () => {
        const { term } = makeTerm()
        await write(term, seq(1, 50))
        await write(term, CLEAR)
        expect(nonEmpty(allLines(term))).toEqual(seq(1, 50).split('\r\n'))
        expect(nonEmpty(screenLines(term))).toEqual([])
        expect(term.buffer.active.cursorY).toBe(0)
        expect(term.buffer.active.cursorX).toBe(0)
    })

    it('pushes only used rows, no blank padding in scrollback', async () => {
        const { term } = makeTerm()
        await write(term, 'a\r\nb\r\nc')
        await write(term, CLEAR)
        const lines = allLines(term)
        // a, b, c in scrollback, then a fresh empty screen
        expect(lines.slice(0, 3)).toEqual(['a', 'b', 'c'])
        expect(lines.length).toBe(3 + ROWS)
    })

    it('clear on an empty screen adds nothing', async () => {
        const { term } = makeTerm()
        await write(term, CLEAR)
        expect(term.buffer.active.length).toBe(ROWS)
    })

    it('repeated clears do not duplicate or pad', async () => {
        const { term } = makeTerm()
        await write(term, 'one')
        await write(term, CLEAR)
        await write(term, 'two')
        await write(term, CLEAR)
        await write(term, CLEAR)
        expect(nonEmpty(allLines(term))).toEqual(['one', 'two'])
        expect(term.buffer.active.length).toBe(2 + ROWS)
    })

    it('ESC[3J alone is ignored', async () => {
        const { term } = makeTerm()
        await write(term, seq(1, 50))
        await write(term, '\x1b[3J')
        expect(nonEmpty(allLines(term))).toEqual(seq(1, 50).split('\r\n'))
    })

    it('DECSED form ESC[?3J is ignored too', async () => {
        const { term } = makeTerm()
        await write(term, seq(1, 50))
        await write(term, '\x1b[?3J')
        expect(nonEmpty(allLines(term))).toEqual(seq(1, 50).split('\r\n'))
    })

    it('stock xterm.js wipes scrollback on ESC[?3J (sanity check that the form matters)', async () => {
        const term = new Terminal({ rows: ROWS, cols: COLS, scrollback: 1000, allowProposedApi: true })
        await write(term, seq(1, 50))
        await write(term, '\x1b[?3J')
        expect(term.buffer.active.length).toBe(ROWS)
    })

    it('DECSED form ESC[H ESC[?2J pushes like ESC[2J', async () => {
        const { term } = makeTerm()
        await write(term, 'a\r\nb')
        await write(term, '\x1b[H\x1b[?2J')
        expect(nonEmpty(allLines(term))).toEqual(['a', 'b'])
    })

    it('dispose removes both handlers', async () => {
        const term = new Terminal({ rows: ROWS, cols: COLS, scrollback: 1000, allowProposedApi: true })
        const h = installKeepScrollback(term as any, () => DEFAULT_SETTINGS)
        h.dispose()
        await write(term, seq(1, 50))
        await write(term, '\x1b[3J\x1b[?3J')
        expect(term.buffer.active.length).toBe(ROWS)
    })

    it('sequences split across writes still work (xterm.js parser handles it)', async () => {
        const { term } = makeTerm()
        await write(term, seq(1, 30))
        for (const ch of CLEAR) {
            await write(term, ch)
        }
        expect(nonEmpty(allLines(term))).toEqual(seq(1, 30).split('\r\n'))
    })

    it('ESC[2J in the alternate screen is not pushed anywhere', async () => {
        const { term } = makeTerm()
        await write(term, 'before')
        await write(term, '\x1b[?1049h')
        await write(term, 'vim screen 1\x1b[H\x1b[2Jvim screen 2\x1b[H\x1b[2J')
        await write(term, '\x1b[?1049l')
        expect(nonEmpty(allLines(term))).toEqual(['before'])
    })

    it('after leaving the alternate screen, clear pushes again', async () => {
        const { term } = makeTerm()
        await write(term, '\x1b[?1049hjunk\x1b[2J\x1b[?1049l')
        await write(term, 'after')
        await write(term, CLEAR)
        expect(nonEmpty(allLines(term))).toEqual(['after'])
        expect(term.buffer.active.length).toBe(1 + ROWS)
    })

    it('partial erases are untouched', async () => {
        const { term } = makeTerm()
        await write(term, 'abc\r\ndef\x1b[1;2H\x1b[J')
        expect(nonEmpty(allLines(term))).toEqual(['a'])
        await write(term, '\x1b[2K')
        expect(nonEmpty(allLines(term))).toEqual([])
    })

    it('restricted scroll region: no push (lines would not reach scrollback anyway)', async () => {
        const { term } = makeTerm()
        await write(term, 'x\r\ny\x1b[2;5r')
        await write(term, '\x1b[2J')
        expect(term.buffer.active.length).toBe(ROWS)
    })

    it('user-initiated clear (xterm.clear()) still wipes everything', async () => {
        const { term } = makeTerm()
        await write(term, seq(1, 50))
        term.clear()
        expect(nonEmpty(allLines(term)).length).toBeLessThanOrEqual(1)
    })

    it('enabled=false restores stock behaviour', async () => {
        const { term } = makeTerm({ enabled: false })
        await write(term, seq(1, 50))
        await write(term, CLEAR)
        expect(nonEmpty(allLines(term))).toEqual([])
    })

    it('blockScrollbackClear=false lets ESC[3J wipe scrollback', async () => {
        const { term } = makeTerm({ blockScrollbackClear: false })
        await write(term, seq(1, 50))
        await write(term, '\x1b[3J')
        expect(term.buffer.active.length).toBe(ROWS)
    })

    it('pushScreenOnClear=false loses only the visible screen', async () => {
        const { term } = makeTerm({ pushScreenOnClear: false })
        await write(term, seq(1, 50))
        await write(term, CLEAR)
        expect(nonEmpty(allLines(term))).toEqual(seq(1, 50 - ROWS).split('\r\n'))
    })

    it('settings are read live', async () => {
        const { term, s } = makeTerm()
        s.enabled = false
        await write(term, seq(1, 20))
        await write(term, '\x1b[3J')
        expect(term.buffer.active.length).toBe(ROWS)
    })

    it('missing internals: warns once, ESC[3J still blocked', async () => {
        const warnings: any[] = []
        const term = new Terminal({ rows: ROWS, cols: COLS, scrollback: 1000, allowProposedApi: true })
        const fake = new Proxy(term as any, {
            get: (t, k) => (k === '_core' ? undefined : (typeof t[k] === 'function' ? t[k].bind(t) : t[k])),
        })
        installKeepScrollback(fake, () => DEFAULT_SETTINGS, { warn: (...a) => warnings.push(a) })
        await write(term, seq(1, 50))
        await write(term, CLEAR)
        await write(term, CLEAR)
        expect(warnings.length).toBe(1)
        expect(nonEmpty(allLines(term))).toEqual(seq(1, 50 - ROWS).split('\r\n'))
    })

    it('usedRows counts to the last non-empty row', async () => {
        const { term } = makeTerm()
        await write(term, 'a\r\n\r\nb')
        expect(usedRows(term as any)).toBe(3)
    })

    describe('only push after cursor home', () => {
        it('ESC[2J with the cursor mid-screen is not pushed', async () => {
            const { term } = makeTerm()
            await write(term, 'a\r\nb')
            await write(term, '\x1b[2J')
            expect(nonEmpty(allLines(term))).toEqual([])
            expect(term.buffer.active.length).toBe(ROWS)
        })

        it('ESC[2J ESC[H (erase, then home) is not pushed', async () => {
            const { term } = makeTerm()
            await write(term, 'a\r\nb')
            await write(term, '\x1b[2J\x1b[H')
            expect(nonEmpty(allLines(term))).toEqual([])
        })

        it('ESC[1;1H and attribute changes between home and erase still count as clear', async () => {
            const { term } = makeTerm()
            await write(term, 'a\r\nb')
            await write(term, '\x1b[1;1H\x1b[0m\x1b[2J')
            expect(nonEmpty(allLines(term))).toEqual(['a', 'b'])
        })

        it('setting off: mid-screen ESC[2J is pushed', async () => {
            const { term } = makeTerm({ onlyPushAfterCursorHome: false })
            await write(term, 'a\r\nb')
            await write(term, '\x1b[2J')
            expect(nonEmpty(allLines(term))).toEqual(['a', 'b'])
        })
    })

    describe('rate limit', () => {
        it('skips clears within the interval of the previous one (sliding window)', async () => {
            let t = 0
            const { term } = makeTerm({}, undefined, () => t)
            await write(term, 'one')
            t = 0; await write(term, CLEAR) // pushed
            await write(term, 'two')
            t = 500; await write(term, CLEAR) // 500 ms after previous: skipped
            await write(term, 'three')
            t = 1000; await write(term, CLEAR) // 500 ms after previous: skipped
            await write(term, 'four')
            t = 2500; await write(term, CLEAR) // 1500 ms after previous: pushed
            expect(nonEmpty(allLines(term))).toEqual(['one', 'four'])
        })

        it('a redraw loop only pushes the screen that was there before it started', async () => {
            let t = 0
            const { term } = makeTerm({}, undefined, () => t)
            await write(term, '$ ./progress')
            for (let i = 0; i < 20; i++) {
                t = i * 100
                await write(term, `\x1b[H\x1b[2Jframe ${i}`)
            }
            expect(nonEmpty(allLines(term))).toEqual(['$ ./progress', 'frame 19'])
        })

        it('minPushIntervalMs=0 disables the limit', async () => {
            const { term } = makeTerm({ minPushIntervalMs: 0 }, undefined, () => 0)
            await write(term, 'one')
            await write(term, CLEAR)
            await write(term, 'two')
            await write(term, CLEAR)
            expect(nonEmpty(allLines(term))).toEqual(['one', 'two'])
        })

        it('erases that are not pushed (alt screen, mid-screen) do not reset the timer', async () => {
            let t = 0
            const { term } = makeTerm({}, undefined, () => t)
            await write(term, 'one')
            t = 0; await write(term, CLEAR)
            t = 500; await write(term, 'x\x1b[2J') // mid-screen: ignored by the limiter
            t = 600; await write(term, '\x1b[?1049h\x1b[H\x1b[2J\x1b[?1049l') // alt screen: ignored
            await write(term, '\x1b[Htwo')
            t = 1200; await write(term, CLEAR) // 1200 ms after the last *qualifying* clear
            expect(nonEmpty(allLines(term))).toEqual(['one', 'two'])
        })
    })

    it('UTF-8 / wide chars survive the push', async () => {
        const { term } = makeTerm()
        await write(term, 'héllo 你好 🎉')
        await write(term, CLEAR)
        expect(nonEmpty(allLines(term))).toEqual(['héllo 你好 🎉'])
    })
})
