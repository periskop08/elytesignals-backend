const db = require('./database');
const googleApi = require('./google-api');

(async () => {
    try {
        const threeHoursAgo = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
        const signals = await db.all("SELECT id, symbol, status FROM signals WHERE status != 'ACTIVE' AND updatedAt >= ?", [threeHoursAgo]);
        console.log(`Found ${signals.length} recently closed signals.`);
        for (let s of signals) {
            console.log(`Syncing ${s.symbol} to ${s.status}...`);
            await googleApi.updateSheetSignalStatus(s.id, s.status);
        }
        console.log("Sync complete.");
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
})();
