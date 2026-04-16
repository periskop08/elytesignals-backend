const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.resolve(__dirname, 'signals.db');

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening db:', err.message);
        process.exit(1);
    }
});

function getStatsForDate(dateStr) {
    return new Promise((resolve, reject) => {
        // Status can be WIN, LOSS, ACTIVE
        const query = `
            SELECT 
                COUNT(*) as totalSignals,
                SUM(CASE WHEN status = 'WIN' THEN 1 ELSE 0 END) as tpCount,
                SUM(CASE WHEN status = 'LOSS' THEN 1 ELSE 0 END) as slCount,
                SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END) as activeCount
            FROM signals 
            WHERE date(createdAt) = ?
        `;
        db.get(query, [dateStr], (err, row) => {
            if (err) return reject(err);
            resolve(row);
        });
    });
}

async function run() {
    const dates = ['2026-04-11', '2026-04-12', '2026-04-13'];
    for (const d of dates) {
        try {
            const stats = await getStatsForDate(d);
            const totalClosed = stats.tpCount + stats.slCount;
            let wr = 0;
            if (totalClosed > 0) {
                wr = (stats.tpCount / totalClosed) * 100;
            }
            console.log(`--- DATE: ${d} ---`);
            console.log(`Total Signals (Including Active): ${stats.totalSignals}`);
            console.log(`TP (WIN): ${stats.tpCount}`);
            console.log(`SL (LOSS): ${stats.slCount}`);
            console.log(`Win Rate (From Closed): %${wr.toFixed(2)}`);
            console.log('-------------------\n');
        } catch(e) {
            console.error(e);
        }
    }
    db.close();
}

run();
