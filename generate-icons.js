// Run this script to generate PNG icons from SVG
// Requires: npm install sharp

const fs = require('fs');

// Simple clock icon SVG
const svgIcon = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192">
  <rect width="192" height="192" rx="40" fill="#4f46e5"/>
  <circle cx="96" cy="96" r="60" fill="none" stroke="white" stroke-width="8"/>
  <line x1="96" y1="96" x2="96" y2="56" stroke="white" stroke-width="8" stroke-linecap="round"/>
  <line x1="96" y1="96" x2="126" y2="96" stroke="white" stroke-width="8" stroke-linecap="round"/>
  <circle cx="96" cy="96" r="6" fill="white"/>
</svg>
`;

// Write SVG file that can be used directly
fs.writeFileSync('public/icon.svg', svgIcon.trim());
console.log('Created icon.svg');

// For PNG generation, you would need the 'sharp' package:
// npm install sharp
// Then uncomment the code below:

/*
const sharp = require('sharp');

async function generateIcons() {
  const svgBuffer = Buffer.from(svgIcon);

  await sharp(svgBuffer)
    .resize(192, 192)
    .png()
    .toFile('public/icon-192.png');
  console.log('Created icon-192.png');

  await sharp(svgBuffer)
    .resize(512, 512)
    .png()
    .toFile('public/icon-512.png');
  console.log('Created icon-512.png');
}

generateIcons();
*/

console.log('\\nTo generate PNG icons, run:');
console.log('  npm install sharp');
console.log('  Then uncomment the sharp code in this file and run again');
console.log('\\nAlternatively, use an online SVG to PNG converter with icon.svg');
