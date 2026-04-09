const Jimp = require('jimp');

async function createTestImage() {
    console.log("Loading base image...");
    try {
        const image = await Jimp.read('pnl_base.png');
        
        console.log("Loading fonts...");
        // Use 64 size for the main ROE, 32 for the profit details
        const font64 = await Jimp.loadFont(Jimp.FONT_SANS_64_WHITE);
        const font32 = await Jimp.loadFont(Jimp.FONT_SANS_32_WHITE);
        
        const roeRaw = '+240.50% ROE';
        const roeNum = roeRaw.split('%')[0] + '%'; 
        const profitRaw = 'Profit: $12,450.50 USDT';
        const symbolStr = 'BTC-USDT';
        const sideStr = 'LONG 10X';

        // Coordinates:
        // We want ROE aligned center
        image.print(
            font64,
            0,
            420,
            {
                text: roeRaw,
                alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER
            },
            1024
        );

        image.print(
            font32,
            0,
            500,
            {
                text: profitRaw,
                alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER
            },
            1024
        );
        
        // Print the side and symbol dynamically (left/right or center top line)
        image.print(
            font32,
            0,
            330,
            {
                text: `${symbolStr}   |   ${sideStr}`,
                alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER
            },
            1024
        );

        await image.writeAsync('pnl_test_output.png');
        console.log("Image saved to pnl_test_output.png");
    } catch (e) {
        console.error("Error drawing image:", e);
    }
}

createTestImage();
