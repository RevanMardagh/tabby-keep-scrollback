import { NgModule } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import TabbyCoreModule, { ConfigProvider } from 'tabby-core'
import { TerminalDecorator } from 'tabby-terminal'
import { SettingsTabProvider } from 'tabby-settings'

import { KeepScrollbackConfigProvider } from './config'
import { KeepScrollbackDecorator } from './decorator'
import { KeepScrollbackSettingsTabComponent, KeepScrollbackSettingsTabProvider } from './settings'

@NgModule({
    // TabbyCoreModule provides the <toggle> component used by the settings tab
    imports: [CommonModule, FormsModule, TabbyCoreModule],
    providers: [
        { provide: ConfigProvider, useClass: KeepScrollbackConfigProvider, multi: true },
        { provide: TerminalDecorator, useClass: KeepScrollbackDecorator, multi: true },
        { provide: SettingsTabProvider, useClass: KeepScrollbackSettingsTabProvider, multi: true },
    ],
    declarations: [KeepScrollbackSettingsTabComponent],
})
export default class KeepScrollbackModule { }
