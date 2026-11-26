import { Component, Injectable } from '@angular/core'
import { ConfigService } from 'tabby-core'
import { SettingsTabProvider } from 'tabby-settings'

/**
 * Settings → Keep scrollback. Binds straight to `config.store.keepScrollback`; the
 * decorator reads settings live on every clear, so changes apply without a restart.
 * Layout and classes follow Tabby's own settings tabs (`.form-line`, `toggle`).
 */
@Component({
    template: `
        <h3 class="mb-3">Keep scrollback</h3>

        <div class="form-line">
            <div class="header">
                <div class="title">Enable</div>
                <div class="description">Master switch. When off, clears behave like stock Tabby.</div>
            </div>
            <toggle
                [(ngModel)]="config.store.keepScrollback.enabled"
                (ngModelChange)="config.save()"
            ></toggle>
        </div>

        <div class="form-line">
            <div class="header">
                <div class="title">Ignore requests to wipe scrollback</div>
                <div class="description">Drop ESC[3J / ESC[?3J sent by programs (e.g. <code>clear</code> on Linux).</div>
            </div>
            <toggle
                [(ngModel)]="config.store.keepScrollback.blockScrollbackClear"
                (ngModelChange)="config.save()"
                [disabled]="!config.store.keepScrollback.enabled"
            ></toggle>
        </div>

        <div class="form-line">
            <div class="header">
                <div class="title">Push screen into scrollback on clear</div>
                <div class="description">On ESC[2J, scroll the visible lines up into scrollback before erasing.</div>
            </div>
            <toggle
                [(ngModel)]="config.store.keepScrollback.pushScreenOnClear"
                (ngModelChange)="config.save()"
                [disabled]="!config.store.keepScrollback.enabled"
            ></toggle>
        </div>

        <div class="form-line">
            <div class="header">
                <div class="title">Only push when the cursor is at the top-left</div>
                <div class="description">
                    <code>clear</code> moves the cursor home before erasing; redrawing tools usually don't.
                    Turn off if <code>cls</code> or a remote <code>clear</code> isn't pushed.
                </div>
            </div>
            <toggle
                [(ngModel)]="config.store.keepScrollback.onlyPushAfterCursorHome"
                (ngModelChange)="config.save()"
                [disabled]="!config.store.keepScrollback.enabled || !config.store.keepScrollback.pushScreenOnClear"
            ></toggle>
        </div>

        <div class="form-line">
            <div class="header">
                <div class="title">Minimum time between pushes (ms)</div>
                <div class="description">Clears closer together than this aren't pushed, so redraw loops can't flood scrollback. 0 disables the limit.</div>
            </div>
            <input
                class="form-control"
                type="number"
                min="0"
                step="100"
                [(ngModel)]="config.store.keepScrollback.minPushIntervalMs"
                (ngModelChange)="config.save()"
                [disabled]="!config.store.keepScrollback.enabled || !config.store.keepScrollback.pushScreenOnClear"
            >
        </div>
    `,
})
export class KeepScrollbackSettingsTabComponent {
    constructor (public config: ConfigService) { }
}

@Injectable()
export class KeepScrollbackSettingsTabProvider extends SettingsTabProvider {
    id = 'keep-scrollback'
    icon = 'scroll'
    title = 'Keep scrollback'

    getComponentType (): any {
        return KeepScrollbackSettingsTabComponent
    }
}
