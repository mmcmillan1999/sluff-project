const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

async function optimizeImage(inputPath, outputPath, maxWidth = 1200) {
  try {
    const metadata = await sharp(inputPath).metadata();
    
    // Only resize if image is larger than maxWidth
    const width = metadata.width > maxWidth ? maxWidth : metadata.width;
    
    await sharp(inputPath)
      .resize(width, null, {
        withoutEnlargement: true,
        fit: 'inside'
      })
      .png({ quality: 85, compressionLevel: 9 })
      .toFile(outputPath);
    
    const inputStats = fs.statSync(inputPath);
    const outputStats = fs.statSync(outputPath);
    
    console.log(`Optimized ${path.basename(inputPath)}:`);
    console.log(`  Original: ${(inputStats.size / 1024 / 1024).toFixed(2)}MB`);
    console.log(`  Optimized: ${(outputStats.size / 1024 / 1024).toFixed(2)}MB`);
    console.log(`  Reduction: ${((1 - outputStats.size / inputStats.size) * 100).toFixed(1)}%`);
  } catch (error) {
    console.error(`Error optimizing ${inputPath}:`, error);
  }
}

async function main() {
  const publicDir = path.join(__dirname, '..', 'public');
  
  // Optimize the main logos
  await optimizeImage(
    path.join(publicDir, 'SluffLogo.png'),
    path.join(publicDir, 'SluffLogo_optimized.png')
  );
  
  await optimizeImage(
    path.join(publicDir, 'SluffLogo_bLackfont.png'),
    path.join(publicDir, 'SluffLogo_bLackfont_optimized.png')
  );
  
  console.log('\nImage optimization complete!');
}

main().catch(console.error);