import { Injectable } from '@angular/core'
import { ConfigService } from 'tabby-core'
import { TerminalDecorator, BaseTerminalTabComponent } from 'tabby-terminal'
import { installKeepScrollback, DEFAULT_SETTINGS, KeepScrollbackSettings } from './keepScrollback'

const LOG_PREFIX = 'tabby-keep-scrollback:'

/**
 * Installs the clear handlers on each terminal tab's xterm.js instance.
 * A tab's frontend is created once and lives as long as the tab, so sessions
 * being replaced (reconnect/restart) don't matter here.
 */
@Injectable()
export class KeepScrollbackDecorator extends TerminalDecorator {
    private installed = new WeakMap<BaseTerminalTabComponent<any>, { dispose (): void }>()

    constructor (private config: ConfigService) {
        super()
    }

    attach (terminal: BaseTerminalTabComponent<any>): void {
        const xterm = (terminal.frontend as any)?.xterm
        if (!xterm?.parser?.registerCsiHandler) {
            console.warn(LOG_PREFIX, 'terminal frontend is not xterm.js, plugin inactive for this tab')
            return
        }
        const handle = installKeepScrollback(xterm, () => this.getSettings(), console)
        this.installed.set(terminal, handle)
    }

    detach (terminal: BaseTerminalTabComponent<any>): void {
        this.installed.get(terminal)?.dispose()
        this.installed.delete(terminal)
        super.detach(terminal)
    }

    private getSettings (): KeepScrollbackSettings {
        const s = this.config.store?.keepScrollback ?? {}
        return {
            enabled: s.enabled ?? DEFAULT_SETTINGS.enabled,
            blockScrollbackClear: s.blockScrollbackClear ?? DEFAULT_SETTINGS.blockScrollbackClear,
            pushScreenOnClear: s.pushScreenOnClear ?? DEFAULT_SETTINGS.pushScreenOnClear,
        }
    }
}
