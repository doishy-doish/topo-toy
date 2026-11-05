import { chromium } from "playwright";
import fs from "node:fs";
fs.mkdirSync("shots", { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.goto("https://doishy-doish.github.io/topo-toy/", { waitUntil: "networkidle" });
const logLines = [];
const log = (...a) => { const s = a.map(String).join(" "); logLines.push(s); console.log(s); };
page.on("console", (m) => { try { logLines.push("[browser:" + m.type() + "] " + m.text().slice(0, 300)); } catch (e) {} });
try {
  await page.waitForFunction(() => window.__wasmStatus && window.__wasmStatus !== "pending", { timeout: 30000 });
} catch (e) { logLines.push("WASM-STATUS-TIMEOUT: " + String((e && e.message) || e).split("\n")[0]); }
log("ENGINE:", await page.evaluate(() => window.__wasmStatus));
async function runPreset(name, shot) {
  if (name) await page.selectOption("#preset", name);
  await page.click("#runBtn");
  await page.waitForFunction(() => !document.getElementById("runBtn").disabled, { timeout: 180000 });
  const stats = await page.textContent("#stats");
  const ver = await page.textContent("#verify");
  log("PRESET " + (name || "cantilever") + " STATS:", stats);
  log("PRESET " + (name || "cantilever") + " VERIFY:", ver);
  if (/NaN|undefined|\berror\b/i.test(ver)) { log("PRESET-FAIL " + (name || "cantilever")); process.exitCode = 1; }
  if (shot) await page.locator("#cv").screenshot({ path: "shots/" + shot });
}
await runPreset(null, "canvas-cantilever.png");
await runPreset("bridge", "canvas-bridge.png");
await runPreset("mbb", "canvas-mbb.png");
await runPreset("lbracket", "canvas-lbracket.png");
// pro path (topopt-port): penal continuation flag shows in stats, stress readout appends σvm
await page.check("#penalChk");
await page.click("#runBtn");
await page.waitForFunction(() => !document.getElementById("runBtn").disabled, { timeout: 180000 });
const proStats = await page.textContent("#stats");
log("PRO-PENAL STATS:", proStats);
if (!/pro:penal=cont/.test(proStats)) { log("PRO-PENAL-FAIL"); process.exitCode = 1; }
await page.click("#stressBtn");
const sStats = await page.textContent("#stats");
log("PRO-STRESS STATS:", sStats);
if (!/σvm max/.test(sStats)) { log("PRO-STRESS-FAIL"); process.exitCode = 1; }
await page.uncheck("#penalChk");
await page.screenshot({ path: "shots/page.png" });
await browser.close();
fs.writeFileSync("shots/verify-log.txt", logLines.join("\n") + "\n");
console.log("shots saved");
