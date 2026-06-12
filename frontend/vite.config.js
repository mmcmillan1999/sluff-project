import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Components are .js files containing JSX (CRA legacy), so .js is parsed as JSX.
export default defineConfig({
    plugins: [react()],
    esbuild: {
        loader: 'jsx',
        include: /src\/.*\.jsx?$/,
        exclude: [],
    },
    optimizeDeps: {
        esbuildOptions: {
            loader: { '.js': 'jsx' },
        },
    },
    server: {
        port: 3000,
        open: true,
    },
    build: {
        outDir: 'build',
    },
    test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: './src/setupTests.js',
    },
});
