const fs = require('fs');
const path = require('path');

const publicDir = path.join(__dirname, 'public');
const assetsDir = path.join(publicDir, 'assets', 'logo');

if (!fs.existsSync(path.join(publicDir, 'assets'))) fs.mkdirSync(path.join(publicDir, 'assets'));
if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir);

// Minimal valid PNG (red 1x1 pixel for logo to make it slightly visible, or transparent for others)
const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

// Valid minimal ICO (16x16 transparent)
const icoBase64 = "AAABAAEAEBAQAAAAAAAoAQAAFgAAACgAAAAQAAAAIAAAAAEABAAAAAAAgAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAA/4QAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";

fs.writeFileSync(path.join(assetsDir, 'vinculo-logo.png'), Buffer.from(pngBase64, 'base64'));
fs.writeFileSync(path.join(publicDir, 'favicon.ico'), Buffer.from(icoBase64, 'base64'));
fs.writeFileSync(path.join(publicDir, 'favicon-16x16.png'), Buffer.from(pngBase64, 'base64'));
fs.writeFileSync(path.join(publicDir, 'favicon-32x32.png'), Buffer.from(pngBase64, 'base64'));
fs.writeFileSync(path.join(publicDir, 'apple-touch-icon.png'), Buffer.from(pngBase64, 'base64'));

console.log('Assets created successfully.');
