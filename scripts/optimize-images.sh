#!/bin/bash

# Script to optimize images and create app icons for Sluff Card Game
# Requires ImageMagick to be installed: sudo apt-get install imagemagick

echo "🎨 Sluff Card Game - Image Optimization Script"
echo "============================================="

# Check if ImageMagick is installed
if ! command -v convert &> /dev/null; then
    echo "❌ ImageMagick is not installed. Please install it first:"
    echo "   Ubuntu/Debian: sudo apt-get install imagemagick"
    echo "   macOS: brew install imagemagick"
    exit 1
fi

# Create directories for optimized images
mkdir -p ../frontend/public/optimized
mkdir -p ../frontend/public/app-icons/ios
mkdir -p ../frontend/public/app-icons/android

# Source image (using the black font logo as it's clearer)
SOURCE_IMAGE="../frontend/public/SluffLogo_bLackfont.png"

if [ ! -f "$SOURCE_IMAGE" ]; then
    echo "❌ Source image not found: $SOURCE_IMAGE"
    exit 1
fi

echo "📸 Using source image: $SOURCE_IMAGE"

# Optimize the main logos
echo "🔧 Optimizing main logo files..."
convert "$SOURCE_IMAGE" -quality 85 -strip ../frontend/public/optimized/SluffLogo_optimized.png
convert ../frontend/public/SluffLogo.png -quality 85 -strip ../frontend/public/optimized/SluffLogo_white_optimized.png

# Create PWA icons
echo "📱 Creating PWA icons..."
convert "$SOURCE_IMAGE" -resize 192x192 ../frontend/public/logo192.png
convert "$SOURCE_IMAGE" -resize 512x512 ../frontend/public/logo512.png

# Create iOS app icons
echo "🍎 Creating iOS app icons..."
# App Store icon
convert "$SOURCE_IMAGE" -resize 1024x1024 ../frontend/public/app-icons/ios/icon-1024.png
# iPhone icons
convert "$SOURCE_IMAGE" -resize 180x180 ../frontend/public/app-icons/ios/icon-180.png
convert "$SOURCE_IMAGE" -resize 120x120 ../frontend/public/app-icons/ios/icon-120.png
convert "$SOURCE_IMAGE" -resize 87x87 ../frontend/public/app-icons/ios/icon-87.png
convert "$SOURCE_IMAGE" -resize 80x80 ../frontend/public/app-icons/ios/icon-80.png
convert "$SOURCE_IMAGE" -resize 60x60 ../frontend/public/app-icons/ios/icon-60.png
convert "$SOURCE_IMAGE" -resize 58x58 ../frontend/public/app-icons/ios/icon-58.png
convert "$SOURCE_IMAGE" -resize 40x40 ../frontend/public/app-icons/ios/icon-40.png
convert "$SOURCE_IMAGE" -resize 29x29 ../frontend/public/app-icons/ios/icon-29.png
convert "$SOURCE_IMAGE" -resize 20x20 ../frontend/public/app-icons/ios/icon-20.png
# iPad icons
convert "$SOURCE_IMAGE" -resize 167x167 ../frontend/public/app-icons/ios/icon-167.png
convert "$SOURCE_IMAGE" -resize 152x152 ../frontend/public/app-icons/ios/icon-152.png
convert "$SOURCE_IMAGE" -resize 76x76 ../frontend/public/app-icons/ios/icon-76.png

# Create Android app icons
echo "🤖 Creating Android app icons..."
# Adaptive icon layers (with padding for safe zone)
convert "$SOURCE_IMAGE" -resize 432x432 -gravity center -extent 512x512 ../frontend/public/app-icons/android/icon-512.png
# Standard icons
convert "$SOURCE_IMAGE" -resize 192x192 ../frontend/public/app-icons/android/icon-192.png
convert "$SOURCE_IMAGE" -resize 144x144 ../frontend/public/app-icons/android/icon-144.png
convert "$SOURCE_IMAGE" -resize 96x96 ../frontend/public/app-icons/android/icon-96.png
convert "$SOURCE_IMAGE" -resize 72x72 ../frontend/public/app-icons/android/icon-72.png
convert "$SOURCE_IMAGE" -resize 48x48 ../frontend/public/app-icons/android/icon-48.png
convert "$SOURCE_IMAGE" -resize 36x36 ../frontend/public/app-icons/android/icon-36.png

# Create favicon
echo "🌐 Creating favicon..."
convert "$SOURCE_IMAGE" -resize 16x16 ../frontend/public/favicon-16.png
convert "$SOURCE_IMAGE" -resize 32x32 ../frontend/public/favicon-32.png
convert "$SOURCE_IMAGE" -resize 48x48 ../frontend/public/favicon-48.png
convert ../frontend/public/favicon-16.png ../frontend/public/favicon-32.png ../frontend/public/favicon-48.png ../frontend/public/favicon.ico

# Get file sizes
echo ""
echo "📊 File size comparison:"
echo "Original SluffLogo_bLackfont.png: $(du -h ../frontend/public/SluffLogo_bLackfont.png | cut -f1)"
echo "Optimized SluffLogo_optimized.png: $(du -h ../frontend/public/optimized/SluffLogo_optimized.png | cut -f1)"

echo ""
echo "✅ Image optimization complete!"
echo ""
echo "📁 Generated files:"
echo "  - PWA icons: frontend/public/logo192.png, logo512.png"
echo "  - iOS icons: frontend/public/app-icons/ios/"
echo "  - Android icons: frontend/public/app-icons/android/"
echo "  - Optimized logos: frontend/public/optimized/"
echo ""
echo "💡 Next steps:"
echo "  1. Update your app wrapper configuration to use these icons"
echo "  2. Replace the original large images with optimized versions"
echo "  3. Test the icons on different devices"