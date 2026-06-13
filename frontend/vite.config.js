import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Dev-only endpoint used by public/sound-audition.html to save microphone
// recordings straight into public/Sounds as the next "<base>_v<n>.<ext>".
function soundRecorderPlugin() {
    const SOUNDS_DIR = path.resolve(__dirname, 'public/Sounds');
    return {
        name: 'sluff-sound-recorder',
        configureServer(server) {
            server.middlewares.use('/__save-sound', (req, res) => {
                if (req.method !== 'POST') {
                    res.statusCode = 405;
                    res.end('POST only');
                    return;
                }
                const url = new URL(req.url, 'http://localhost');
                const base = (url.searchParams.get('base') || 'recording').replace(/[^a-zA-Z0-9_\-]/g, '_');
                const ext = (url.searchParams.get('ext') || 'webm').replace(/[^a-z0-9]/gi, '');
                const chunks = [];
                req.on('data', (c) => chunks.push(c));
                req.on('end', () => {
                    try {
                        const buf = Buffer.concat(chunks);
                        const esc = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        const re = new RegExp('^' + esc + '_v(\\d+)\\.', 'i');
                        let max = 0;
                        for (const f of fs.readdirSync(SOUNDS_DIR)) {
                            const m = f.match(re);
                            if (m) max = Math.max(max, parseInt(m[1], 10));
                        }
                        const name = `${base}_v${max + 1}.${ext}`;
                        fs.writeFileSync(path.join(SOUNDS_DIR, name), buf);
                        res.setHeader('Content-Type', 'application/json');
                        res.end(JSON.stringify({ ok: true, file: name }));
                    } catch (e) {
                        res.statusCode = 500;
                        res.setHeader('Content-Type', 'application/json');
                        res.end(JSON.stringify({ ok: false, error: String(e && e.message || e) }));
                    }
                });
            });
        },
    };
}

// Components are .js files containing JSX (CRA legacy), so .js is parsed as JSX.
export default defineConfig({
    plugins: [react(), soundRecorderPlugin()],
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
