const sharp = require('sharp');
const path = require('path');

async function generateIcon(inputPath, size) {
  const outputPath = path.join(
    path.dirname(inputPath),
    `logo${size}.png`
  );
  
  try {
    await sharp(inputPath)
      .resize(size, size, {
        fit: 'contain',
        background: { r: 255, g: 255, b: 255, alpha: 0 }
      })
      .png()
      .toFile(outputPath);
    
    console.log(`✓ Generated ${size}x${size} icon`);
  } catch (error) {
    console.error(`✗ Error generating ${size}x${size} icon:`, error.message);
  }
}

async function main() {
  const publicDir = path.join(__dirname, '..', 'public');
  const sourceLogo = path.join(publicDir, 'logo512.png');
  
  // Required sizes for PWA
  const sizes = [72, 96, 128, 144, 152, 384];
  
  console.log('Generating app icons...\n');
  
  for (const size of sizes) {
    await generateIcon(sourceLogo, size);
  }
  
  console.log('\nIcon generation complete!');
}

main().catch(console.error);