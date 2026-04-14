require('dotenv').config();
const { runArifBey } = require('./arif_bey');
const { sendDailyNewsReport } = require('./news_agent');

async function triggerMissing() {
    console.log("Triggering Hamdi Bey...");
    try { await sendDailyNewsReport(); } catch(e) { console.error(e); }
    
    console.log("Triggering Arif Bey...");
    try { await runArifBey(); } catch(e) { console.error(e); }
    
    console.log("Done missing triggers.");
    process.exit(0);
}
triggerMissing();
