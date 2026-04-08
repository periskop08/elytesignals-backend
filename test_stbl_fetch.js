const { fetchIntervalData } = require('./index.js');
async function run() {
    try {
        console.log("Fetching STBLUSDT...");
        const res = await fetchIntervalData("STBLUSDT", "4h");
        console.log("SUCCESS length:", res.length);
    } catch(e) {
        console.error("FAILED externally:", e.message, e.stack);
    }
    setTimeout(() => process.exit(0), 1000);
}
setTimeout(run, 2000);
