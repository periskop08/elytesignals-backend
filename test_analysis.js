const { getAnalysis } = require('./index.js');
async function run() {
  try {
    const res = await getAnalysis("STBL", "STBL Long").catch(e => {
        console.error("Caught internally:", e);
    });
    console.log("Analysis Result:", res);
  } catch(e) { console.error("Caught externally:", e); }
  setTimeout(() => process.exit(0), 1000);
}
setTimeout(run, 2000);
