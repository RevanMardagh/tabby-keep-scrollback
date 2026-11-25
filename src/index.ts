import { NgModule } from '@angular/core'
import { ConfigProvider } from 'tabby-core'
import { TerminalDecorator } from 'tabby-terminal'

import { KeepScrollbackConfigProvider } from './config'
import { KeepScrollbackDecorator } from './decorator'

@NgModule({
    providers: [
        { provide: ConfigProvider, useClass: KeepScrollbackConfigProvider, multi: true },
        { provide: TerminalDecorator, useClass: KeepScrollbackDecorator, multi: true },
    ],
})
export default class KeepScrollbackModule { }
