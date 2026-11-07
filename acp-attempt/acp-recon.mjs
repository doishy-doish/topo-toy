// ACP minibrowser RECON (attempt 1): observe-only. No credentials entered,
// no signatures, no accounts created, IS_TESTNET=true. Maps the login UI so
// attempt 2 knows exactly what to automate. Results -> acp-attempt-out/.
import { chromium } from "playwright";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const steps = [];
const step = (k, v) => {
  const s = String(v);
  steps.push({ t: new Date().toISOString(), k, v: s.slice(0, 2000) });
  console.log("##", k, s.slice(0, 500));
};
const run = (cmd, args, extraEnv = {}) => {
  try {
    const o = execFileSync(cmd, args, {
      encoding: "utf8",
      timeout: 180000,
      env: { ...process.env, ...extraEnv },
    });
    return { ok: true, out: o.slice(0, 4000) };
  } catch (e) {
    return {
      ok: false,
      code: e.status,
      out: String((e.stdout || "") + (e.stderr || "")).slice(0, 4000),
    };
  }
};

fs.mkdirSync("acp-shots", { recursive: true });
fs.mkdirSync("acp-attempt-out", { recursive: true });
step("script-version", "1d-mainnet-curl");

step("node", process.version);
step("install-cli", JSON.stringify(run("npm", ["i", "-g", "@virtuals-protocol/acp-cli"])));
step("cli-version", JSON.stringify(run("acp", ["--version"])));
const skill = run("acp", ["skill", "print"]);
step("skill-print", skill.out.slice(0, 3000));

const env = { IS_TESTNET: "true", ACP_CONFIG_DIR: process.cwd() + "/acp-home" };
const envMain = { ACP_CONFIG_DIR: process.cwd() + "/acp-home" };
const sMain = run("acp", ["configure", "start", "--json"], envMain);
step("configure-start-mainnet", JSON.stringify(sMain));
let urlMain = null;
try {
  const m = sMain.out.match(/\{[\s\S]*\}/);
  const j = JSON.parse(m ? m[0] : "{}");
  urlMain = j.url || null;
} catch (e) { step("parse-main-fail", String(e).slice(0, 200)); }
step("parsed-main", JSON.stringify({ host: urlMain ? new URL(urlMain).host : null }));
if (urlMain) {
  step("curl-main", JSON.stringify(run("curl", ["-sS", "-D", "-", "-o", "/dev/null", "-w", "HTTP:%{http_code} time:%{time_total}s ip:%{remote_ip}", "--max-time", 30, urlMain])));
}
const s = run("acp", ["configure", "start", "--json"], env);
step("configure-start", JSON.stringify(s));

let url = null;
let requestId = null;
try {
  const m = s.out.match(/\{[\s\S]*\}/);
  const j = JSON.parse(m ? m[0] : "{}");
  url = j.url || null;
  requestId = j.requestId || null;
} catch (e) {
  step("parse-fail", String(e).slice(0, 300));
}
step("parsed", JSON.stringify({ host: url ? new URL(url).host : null, hasReq: !!requestId }));
if (url) {
  step("curl-testnet", JSON.stringify(run("curl", ["-sS", "-D", "-", "-o", "/dev/null", "-w", "HTTP:%{http_code} time:%{time_total}s", "--max-time", 30, url])));
}

if (url) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("console", (m) => step("page-console", m.type() + " " + m.text().slice(0, 300)));
  page.on("requestfailed", (r) => step("req-fail", r.url().slice(0, 160) + " :: " + ((r.failure() || {}).errorText || "")));
  page.on("response", (r) => { if (r.status() >= 400) step("http-" + r.status(), r.url().slice(0, 160)); });
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(5000);
    await page.screenshot({ path: "acp-shots/login-early.png" });
    // wait up to 40s for the app to render anything actionable
    let info = null;
    for (let i = 0; i < 20; i++) {
      info = await page.evaluate(() => ({
        url: location.href,
        title: document.title,
        buttons: [...document.querySelectorAll("button")]
          .map((b) => b.innerText.trim())
          .filter(Boolean)
          .slice(0, 30),
        inputs: [...document.querySelectorAll("input")]
          .map((i) => i.placeholder || i.type || i.name)
          .slice(0, 20),
        text: document.body.innerText.slice(0, 2000),
      }));
      if (info.buttons.length || info.inputs.length || info.text.trim().length > 50) break;
      await page.waitForTimeout(2000);
    }
    step("login-page", JSON.stringify(info));
    await page.screenshot({ path: "acp-shots/login.png" });
    await page.screenshot({ path: "acp-shots/login-full.png", fullPage: true });
  } catch (e) {
    step("browser-fail", String(e).slice(0, 1000));
  }
  await browser.close();
}

if (requestId) {
  step("configure-complete-once", JSON.stringify(run(
    "acp", ["configure", "complete", "--request-id", requestId, "--json"], env
  )));
}

fs.writeFileSync(
  "acp-attempt-out/result.json",
  JSON.stringify({ testnet: true, steps }, null, 2)
);
step("done", "result.json written");
