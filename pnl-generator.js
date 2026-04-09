const sharp = require('sharp');

/**
 * Dinamik Telegram PNL Kartı Çizici (SVG Tabanlı Keskin Render)
 * Gelen sembol, PNL verisi ve kâr oranına göre yüksek çözünürlüklü SVG'yi PNG'ye dönüştürür.
 * Buffer, TelegramBot API tarafından doğrudan sendPhoto ile okunabilir.
 */
async function generatePnlImage(symbol, side, pnlPercentage, netUsdProfit, isWin) {
    try {
        const width = 1200;
        const height = 675; // 16:9 Geniş Ekran Formatı
        
        const operator = isWin ? '+' : '';
        const operatorColor = isWin ? 'url(#neon-green)' : 'url(#neon-red)';
        const roeStr = `${operator}${parseFloat(pnlPercentage).toFixed(2)}% ROE`;
        
        let profitStr = '';
        if (netUsdProfit && !isNaN(netUsdProfit)) {
             profitStr = `Net PNL: ${operator}$${parseFloat(netUsdProfit).toFixed(2)} USDT`;
        } else {
             profitStr = isWin ? `TP Hedefine Ulaşıldı 🎯` : `Zarar Durduruldu 🛑`;
        }

        const symbolStr = symbol.replace('-USDT', '');
        
        // PNL Kartı SVG'si (Saf Glassmorphism)
        const svgContent = \`
        <svg width="\${width}" height="\${height}" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <radialGradient id="bg-grad" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
                    <stop offset="0%" stop-color="#1E2336" />
                    <stop offset="50%" stop-color="#0F121C" />
                    <stop offset="100%" stop-color="#05070A" />
                </radialGradient>
                
                <linearGradient id="neon-green" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stop-color="#00FF87" />
                    <stop offset="100%" stop-color="#60EFFF" />
                </linearGradient>

                <linearGradient id="neon-red" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stop-color="#FF3366" />
                    <stop offset="100%" stop-color="#FF9933" />
                </linearGradient>

                <linearGradient id="glass-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="rgba(255, 255, 255, 0.08)" />
                    <stop offset="50%" stop-color="rgba(255, 255, 255, 0.02)" />
                    <stop offset="100%" stop-color="rgba(255, 255, 255, 0.00)" />
                </linearGradient>
            </defs>

            <!-- Arka Plan -->
            <rect width="100%" height="100%" fill="url(#bg-grad)" />

            <!-- Dekoratif Arka Plan Cizgileri -->
            <path d="M 0 100 Q 300 150 600 50 T 1200 150" fill="transparent" stroke="rgba(96, 239, 255, 0.05)" stroke-width="2"/>
            <path d="M 0 500 Q 400 450 800 550 T 1200 450" fill="transparent" stroke="rgba(96, 239, 255, 0.03)" stroke-width="2"/>

            <!-- Merkez Cam Panel (Glassmorphism) -->
            <g transform="translate(150, 120)">
                <!-- Glass panel -->
                <rect width="900" height="375" rx="20" fill="url(#glass-grad)" />
                <rect width="900" height="375" rx="20" fill="transparent" stroke="\${operatorColor}" stroke-width="2" opacity="0.5"/>
                <rect width="900" height="375" rx="20" fill="transparent" stroke="\${operatorColor}" stroke-width="6" opacity="0.1"/>

                <!-- Ust Etiketler -->
                <text x="450" y="80" font-family="system-ui, -apple-system, sans-serif" font-weight="700" font-size="28" fill="#A0AEC0" text-anchor="middle" letter-spacing="4">
                    \${symbolStr}   •   \${side}
                </text>

                <!-- Devasa ROE -->
                <text x="450" y="220" font-family="system-ui, -apple-system, sans-serif" font-weight="900" font-size="110" fill="\${operatorColor}" text-anchor="middle">
                    \${roeStr}
                </text>

                <!-- Net PNL -->
                <text x="450" y="320" font-family="system-ui, -apple-system, sans-serif" font-weight="600" font-size="36" fill="#E2E8F0" text-anchor="middle" letter-spacing="1">
                    \${profitStr}
                </text>
            </g>

            <!-- Marka ve İmza (Alt Kısım) -->
            <g transform="translate(600, 580)">
                <text x="0" y="0" font-family="system-ui, -apple-system, sans-serif" font-weight="900" font-size="46" fill="#FFFFFF" text-anchor="middle" letter-spacing="3">
                    ELYTE SIGNALS
                </text>
                <text x="0" y="35" font-family="system-ui, -apple-system, sans-serif" font-weight="500" font-size="22" fill="#718096" text-anchor="middle" letter-spacing="1">
                    Powered by PeriskopAI
                </text>
            </g>
        </svg>
        \`;

        // SVG buffer'ı al ve Sharp üzerinden yuksek cozunurluklu PNG olarak Isle
        return await sharp(Buffer.from(svgContent)).png().toBuffer();

    } catch (e) {
        console.error("[PNL GENERATOR] Sharp SVG Render hatası:", e);
        return null;
    }
}

module.exports = { generatePnlImage };
