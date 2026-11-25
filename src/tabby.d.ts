/**
 * Minimal type declarations for the parts of Tabby this plugin uses.
 * Tabby provides these modules at runtime (they are webpack externals).
 * Checked against Tabby 1.0.231 typings (resources/builtin-plugins/tabby-core|tabby-terminal/typings).
 */

declare module 'tabby-core' {
    export abstract class ConfigProvider {
        defaults: any
        platformDefaults: Record<string, any>
    }
    export class ConfigService {
        store: any
    }
}

declare module 'tabby-terminal' {
    export class BaseTerminalTabComponent<P = any> {
        frontend?: unknown
    }
    export abstract class TerminalDecorator {
        attach (terminal: BaseTerminalTabComponent<any>): void
        detach (terminal: BaseTerminalTabComponent<any>): void
    }
}
