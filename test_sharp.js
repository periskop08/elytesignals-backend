const sharp = require('sharp');

async function createSvgCard() {
    const width = 1200;
    const height = 675; // 16:9 
    
    const symbolStr = 'BTC-USDT';
    const sideStr = 'LONG 10X';
    const roeStr = '+240.50% ROE';
    const profitStr = 'Profit: $12,450.50 USDT';

    // Kaliteli Glassmorphism ve Neon efekti icin SVG
    const svgContent = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <!-- Arkaplan ve Radial Gradient (Karanlık Lüks Tema) -->
        <defs>
            <radialGradient id="bg-grad" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
                <stop offset="0%" stop-color="#1a1e2f" />
                <stop offset="50%" stop-color="#0E111B" />
                <stop offset="100%" stop-color="#05070a" />
            </radialGradient>
            
            <linearGradient id="neon-green" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stop-color="#00ff87" />
                <stop offset="100%" stop-color="#60efff" />
            </linearGradient>

            <linearGradient id="glass-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="rgba(255, 255, 255, 0.08)" />
                <stop offset="100%" stop-color="rgba(255, 255, 255, 0.01)" />
            </linearGradient>

            <!-- Parlama/Gölge Filtreleri -->
            <filter id="glow">
                <feGaussianBlur stdDeviation="8" result="coloredBlur"/>
                <feMerge>
                    <feMergeNode in="coloredBlur"/>
                    <feMergeNode in="SourceGraphic"/>
                </feMerge>
            </filter>
            
            <!-- Cerceve neon parlama -->
            <filter id="boxGlow">
                <feGaussianBlur stdDeviation="15" result="coloredBlur"/>
                <feMerge>
                    <feMergeNode in="coloredBlur"/>
                    <feMergeNode in="SourceGraphic"/>
                </feMerge>
            </filter>
        </defs>

        <!-- Koyu Arkaplan -->
        <rect width="100%" height="100%" fill="url(#bg-grad)" />

        <!-- Arkaplan Çizgileri/Süslemeleri -->
        <path d="M 0 100 Q 300 150 600 50 T 1200 150" fill="transparent" stroke="rgba(0, 255, 135, 0.05)" stroke-width="2"/>
        <path d="M 0 500 Q 400 450 800 550 T 1200 450" fill="transparent" stroke="rgba(96, 239, 255, 0.05)" stroke-width="2"/>

        <!-- Ortadaki Cam Panel (Glassmorphism) -->
        <g transform="translate(150, 150)">
            <!-- Glass arka plani -->
            <rect width="900" height="375" rx="30" fill="url(#glass-grad)" />
            
            <!-- Glass cercevesi neon izi -->
            <rect width="900" height="375" rx="30" fill="transparent" stroke="url(#neon-green)" stroke-width="1.5" opacity="0.6"/>
            <!-- Parlayan Dis Cerceve -->
            <rect width="900" height="375" rx="30" fill="transparent" stroke="url(#neon-green)" stroke-width="4" opacity="0.1" filter="url(#boxGlow)"/>

            <!-- Amblem ve Ufak Yazi -->
            <text x="450" y="70" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-weight="bold" font-size="28" fill="#a0aec0" text-anchor="middle" letter-spacing="4">
                ${symbolStr}   •   ${sideStr}
            </text>

            <!-- Devasa Neon Yüzde -->
            <text x="450" y="210" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-weight="900" font-size="110" fill="url(#neon-green)" text-anchor="middle" filter="url(#glow)">
                ${roeStr}
            </text>

            <!-- Kar Zarar Rakamlari -->
            <text x="450" y="300" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-weight="bold" font-size="34" fill="#e2e8f0" text-anchor="middle">
                ${profitStr}
            </text>
        </g>

        <!-- Elyte Signals Logosu ve Yazisi Alt Orta -->
        <g transform="translate(600, 600)">
            <text x="0" y="0" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-weight="900" font-size="48" fill="#ffffff" text-anchor="middle" letter-spacing="2">
                ELYTE SIGNALS
            </text>
            <text x="0" y="30" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-weight="500" font-size="22" fill="#718096" text-anchor="middle" letter-spacing="1">
                Powered by PeriskopAI
            </text>
        </g>
    </svg>
    `;

    try {
        await sharp(Buffer.from(svgContent))
            .png()
            .toFile('sharp_pnl.png');
        console.log("SVG rendered to sharp_pnl.png via Sharp!");
    } catch (err) {
        console.error("Sharp render failed:", err);
    }
}

createSvgCard();
