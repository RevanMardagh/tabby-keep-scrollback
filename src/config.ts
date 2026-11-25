import { Injectable } from '@angular/core'
import { ConfigProvider } from 'tabby-core'
import { DEFAULT_SETTINGS } from './keepScrollback'

@Injectable()
export class KeepScrollbackConfigProvider extends ConfigProvider {
    defaults = {
        keepScrollback: { ...DEFAULT_SETTINGS },
    }

    platformDefaults = {}
}
