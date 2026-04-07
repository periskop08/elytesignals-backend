const db = require('./database');

async function triggerRebalance() {
    try {
        const assets = await db.all("SELECT * FROM portfolio_assets WHERE lastStatus = 'ACTIVE'");
        if (!assets || assets.length === 0) return { success: true, message: "No active assets to rebalance." };

        let totalAllocated = 0;
        const processedAssets = [];

        // PHASE 1: DD Cutting (Kesici Kural)
        for (const asset of assets) {
            let newAlloc = asset.allocatedPercentage;

            if (asset.drawdown >= 25) {
                newAlloc = 0; // Sell completely
            } else if (asset.drawdown >= 15) {
                newAlloc = newAlloc * 0.5; // Cut 50%
            }

            processedAssets.push({
                ...asset,
                allocatedPercentage: newAlloc
            });
        }

        // PHASE 2: Check liquid capital remaining (100 - sum(newAlloc))
        let currentTotal = processedAssets.reduce((sum, a) => sum + a.allocatedPercentage, 0);
        let liquidCash = 100 - currentTotal;

        if (liquidCash > 0) {
            // Distribute liquid cash to those with high aiScore, not cut by DD (>15)
            const eligibleAssets = processedAssets.filter(a => a.drawdown < 15 && a.aiScore > 0);
            
            if (eligibleAssets.length > 0) {
                // Focus distribution dynamically powered by scores > 70
                const totalScore = eligibleAssets.reduce((sum, a) => sum + Math.max(0, a.aiScore - 70), 0); 

                if (totalScore > 0) {
                    for (const asset of eligibleAssets) {
                        const scoreWeight = Math.max(0, asset.aiScore - 70) / totalScore;
                        const addition = liquidCash * scoreWeight;
                        
                        // Limit maximum to 30% per asset (Risk Capping limit)
                        if (asset.allocatedPercentage + addition <= 30) {
                            asset.allocatedPercentage += addition;
                            currentTotal += addition;
                        } else {
                            const maxAddition = Math.max(0, 30 - asset.allocatedPercentage);
                            asset.allocatedPercentage += maxAddition;
                            currentTotal += maxAddition;
                        }
                    }
                }
            }
            
            // Re-calculate leftover liquid cash
            liquidCash = 100 - currentTotal;
            
            // If liquid cash is still lying around, dump it to safe ETF as hedge
            if (liquidCash > 0.01) {
                const etf = processedAssets.find(a => a.type === 'ETF');
                if (etf) {
                    etf.allocatedPercentage += liquidCash;
                } else if (eligibleAssets.length > 0) {
                    // Spread it roughly to the asset with highest score if no ETF
                    const best = eligibleAssets.reduce((prev, current) => (prev.aiScore > current.aiScore) ? prev : current);
                    best.allocatedPercentage += liquidCash;
                }
            }
        }

        // Write to database
        for (const asset of processedAssets) {
            const finalAlloc = Number(asset.allocatedPercentage.toFixed(1)); // Make it beautiful visually
            await db.run(
                "UPDATE portfolio_assets SET allocatedPercentage = ? WHERE id = ?",
                [finalAlloc, asset.id]
            );
        }

        return { success: true, message: "Rebalance successful! Math rules executed.", updatedAssets: true };

    } catch (e) {
        console.error("Rebalance Math Error:", e);
        return { success: false, error: e.message };
    }
}

module.exports = { triggerRebalance };
