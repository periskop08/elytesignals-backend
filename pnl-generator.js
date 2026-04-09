const sharp = require('sharp');
const path = require('path');

/**
 * Dinamik Telegram PNL Kartı Çizici (Orjinal Mockup Üzerine Composite SVG Overlay)
 */
async function generatePnlImage(symbol, side, pnlPercentage, netUsdProfit, isWin) {
    try {
        const basePath = path.join(__dirname, 'pnl_base_16x9.png');
        
        const operator = isWin ? '+' : '';
        const operatorColor = isWin ? '#00FF87' : '#FF3366';
        
        const roeStr = `${operator}${parseFloat(pnlPercentage).toFixed(2)}% ROE`;
        
        let profitStr = '';
        if (netUsdProfit && !isNaN(netUsdProfit)) {
             profitStr = `Profit: ${operator}$${parseFloat(netUsdProfit).toFixed(2)} USDT`;
        } else {
             profitStr = isWin ? `TP Hedefine Ulaşıldı 🎯` : `Zarar Durduruldu 🛑`;
        }

        const symbolStr = symbol.replace('-USDT', '');
        
        // Sadece yazi kismini (ortadaki maskeleme alanini) donduren SVG sarmalayıcısı
        const svgOverlay = \`
        <svg width="1024" height="1024" xmlns="http://www.w3.org/2000/svg">
            <!-- Orjinal metni tamamen maskeleyen glass/kutu efekti. Parlak distan etkilenmez. -->
            <rect x="100" y="270" width="824" height="420" rx="20" fill="rgba(10, 14, 25, 0.95)" stroke="transparent" />

            <!-- Ust İsimler (Sembol & Yön) -->
            <text x="512" y="380" font-family="system-ui, -apple-system, sans-serif" font-weight="700" font-size="34" fill="#A0AEC0" text-anchor="middle" letter-spacing="3">
                \${symbolStr}   •   \${side}
            </text>

            <!-- Devasa ROE -->
            <text x="512" y="530" font-family="system-ui, -apple-system, sans-serif" font-weight="900" font-size="130" fill="\${operatorColor}" text-anchor="middle">
                \${roeStr}
            </text>

            <!-- Net Profit -->
            <text x="512" y="620" font-family="system-ui, -apple-system, sans-serif" font-weight="600" font-size="42" fill="#E2E8F0" text-anchor="middle" letter-spacing="1">
                \${profitStr}
            </text>
        </svg>
        \`;

        // Ana resmi (16:9 mockup) alıp üzerine SVG katmanını çakıyoruz
        return await sharp(basePath)
            .composite([{
                input: Buffer.from(svgOverlay),
                top: 0,
                left: 0
            }])
            .png()
            .toBuffer();

    } catch (e) {
        console.error("[PNL GENERATOR] Sharp Composite Render hatası:", e);
        return null;
    }
}

module.exports = { generatePnlImage };
