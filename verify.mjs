import { chromium } from "playwright";
import fs from "node:fs";
fs.mkdirSync("shots", { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.goto("https://doishy-doish.github.io/topo-toy/", { waitUntil: "networkidle" });
async function runPreset(name, shot) {
  if (name) await page.selectOption("#preset", name);
  await page.click("#runBtn");
  await page.waitForFunction(() => !document.getElementById("runBtn").disabled, { timeout: 180000 });
  const stats = await page.textContent("#stats");
  const ver = await page.textContent("#verify");
  console.log("PRESET " + (name || "cantilever") + " STATS:", stats);
  console.log("PRESET " + (name || "cantilever") + " VERIFY:", ver);
  if (/NaN|undefined|\berror\b/i.test(ver)) { console.log("PRESET-FAIL " + (name || "cantilever")); process.exitCode = 1; }
  if (shot) await page.locator("#cv").screenshot({ path: "shots/" + shot });
}
await runPreset(null, "canvas-cantilever.png");
await runPreset("bridge", "canvas-bridge.png");
await runPreset("mbb", "canvas-mbb.png");
await runPreset("lbracket", "canvas-lbracket.png");
await page.screenshot({ path: "shots/page.png" });
await browser.close();
console.log("shots saved");
