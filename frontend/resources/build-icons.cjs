// frontend/resources/build-icons.cjs
//
// Rasterises the vector masters into everything @capacitor/assets consumes.
//
//   node resources/build-icons.cjs
//   npm run assets && npx cap sync
//
// Kept separate from `npm run assets` on purpose: this step only needs to run
// when the artwork changes, and it writes the very files that step reads.

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const HERE = __dirname;
const read = name => fs.readFileSync(path.join(HERE, name));

// Android crops adaptive icons to a circle or squircle, so the foreground layer
// is drawn at 62% inside a transparent 1024 canvas — the same safe band the
// full icon uses, but with the felt removed so the launcher can composite.
const FOREGROUND_SCALE = 0.62;

// The splash plate omits the woven texture on purpose. At 2732px the weave is
// stretched into per-pixel grain that nobody can see, and PNG cannot compress
// noise — it was costing 5.8MB per splash against 0.33MB without, and Android
// wants sixteen of them. The icon keeps its weave, where it renders at 1024 and
// actually reads as felt.
const SPLASH_PLATE = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs><radialGradient id="felt" cx="42%" cy="36%" r="78%">
    <stop offset="0%" stop-color="#27543a"/>
    <stop offset="45%" stop-color="#1a3b2a"/>
    <stop offset="100%" stop-color="#0b1711"/>
  </radialGradient></defs>
  <rect width="1024" height="1024" fill="url(#felt)"/>
</svg>`);

async function main() {
    const icon = read('icon.svg');

    const outputs = [
        // The square master. No transparency: iOS rejects an alpha channel.
        {
            name: 'icon.png',
            build: () => sharp(icon, { density: 384 })
                .resize(1024, 1024)
                .flatten({ background: '#0b1711' })
                .png(),
        },
        // Adaptive background: the same felt plate as the square icon, so a
        // launcher does not show a flat green circle beside a gradient icon.
        {
            name: 'icon-background.png',
            build: () => sharp(read('icon-background.svg'), { density: 384 })
                .resize(1024, 1024)
                .flatten({ background: '#0b1711' })
                .png(),
        },
        // Adaptive foreground: the cards on transparency, inset to the safe band.
        {
            name: 'icon-foreground.png',
            build: async () => {
                const inset = Math.round(1024 * FOREGROUND_SCALE);
                const mark = await sharp(read('icon-mark.svg'), { density: 384 })
                    .resize(inset, inset)
                    .png()
                    .toBuffer();
                return sharp({
                    create: {
                        width: 1024, height: 1024, channels: 4,
                        background: { r: 0, g: 0, b: 0, alpha: 0 },
                    },
                }).composite([{ input: mark, gravity: 'centre' }]).png();
            },
        },
        // Splash: every aspect ratio crops the edges hard, so the mark sits in
        // the middle ~34% of a much larger canvas.
        {
            name: 'splash.png',
            build: async () => {
                const mark = await sharp(read('icon-mark.svg'), { density: 384 })
                    .resize(940, 940)
                    .png()
                    .toBuffer();
                const plate = await sharp(SPLASH_PLATE, { density: 384 })
                    .resize(2732, 2732)
                    .flatten({ background: '#0b1711' })
                    .toBuffer();
                return sharp(plate).composite([{ input: mark, gravity: 'centre' }]).png();
            },
        },
    ];

    for (const output of outputs) {
        const pipeline = await output.build();
        await pipeline.toFile(path.join(HERE, output.name));
        const meta = await sharp(path.join(HERE, output.name)).metadata();
        console.log(`  ${output.name.padEnd(24)} ${meta.width}x${meta.height}  ${meta.channels}ch`);
    }

    // splash-dark is the same plate; the app is dark either way.
    fs.copyFileSync(path.join(HERE, 'splash.png'), path.join(HERE, 'splash-dark.png'));
    console.log('  splash-dark.png          (copy of splash.png)');
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
