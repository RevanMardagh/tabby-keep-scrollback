const path = require('path')

module.exports = {
    target: 'node',
    mode: 'production',
    entry: './src/index.ts',
    devtool: 'source-map',
    context: __dirname,
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'index.js',
        library: { type: 'umd' },
        globalObject: 'this',
    },
    resolve: {
        extensions: ['.ts', '.js'],
    },
    module: {
        rules: [
            {
                test: /\.ts$/,
                loader: 'ts-loader',
                options: {
                    configFile: path.resolve(__dirname, 'tsconfig.build.json'),
                },
            },
        ],
    },
    optimization: {
        // keep class names readable in DevTools; the bundle is tiny anyway
        minimize: false,
    },
    externals: [
        /^@angular/,
        /^rxjs/,
        /^tabby-/,
    ],
}
