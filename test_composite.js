const sharp = require('sharp');
const fs = require('fs');

async function createOverlayCard() {
    const symbolStr = 'LTC-USDT';
    const sideStr = 'SHORT 20X';
    const roeStr = '+175.00% ROE';
    const profitStr = 'Profit: $3,210.00 USDT';

    // SVG Overlay. Same dimensions 1024x1024.
    // X,Y coordinates are tuned for the center of the 1024x1024 image.
    const svgOverlay = `
    <svg width="1024" height="1024" xmlns="http://www.w3.org/2000/svg">
        <!-- Masking Rectangle over the original text to hide it!
             The original text is roughly located from y=300 to y=650, x=100 to 900. -->
        <rect x="70" y="270" width="880" height="420" rx="20" fill="rgba(8, 12, 22, 0.90)" stroke="transparent" />

        <!-- Now draw the dynamic text exactly where it should be -->
        <text x="512" y="380" font-family="system-ui, -apple-system, sans-serif" font-weight="700" font-size="34" fill="#a0aec0" text-anchor="middle" letter-spacing="3">
            ${symbolStr}   •   ${sideStr}
        </text>

        <!-- Huge Neon ROE! -->
        <text x="512" y="530" font-family="system-ui, -apple-system, sans-serif" font-weight="900" font-size="130" fill="#00FF87" text-anchor="middle">
            ${roeStr}
        </text>

        <!-- Profit string at bottom of the panel -->
        <text x="512" y="620" font-family="system-ui, -apple-system, sans-serif" font-weight="600" font-size="42" fill="#E2E8F0" text-anchor="middle" letter-spacing="1">
            ${profitStr}
        </text>
    </svg>
    `;

    try {
        await sharp('pnl_base_16x9.png')
            .composite([{
                input: Buffer.from(svgOverlay),
                top: 0,
                left: 0
            }])
            .png()
            .toFile('sharp_composite.png');
            
        console.log("Composite successfully built!");
    } catch (e) {
        console.log("Error:", e);
    }
}

createOverlayCard();
