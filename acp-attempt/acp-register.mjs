// ACP minibrowser ATTEMPT 2: wallet-SIWE registration. Fresh burner keypair
// (viem, in-run, unfunded) injected as window.ethereum; user clicks only
// machine-operated buttons. ALLOWED: configure, agent create, add-signer
// (default restricted), read-only browse. FORBIDDEN: topup, card, tokenize,
// send-transaction, subscriptions, anything spending money.
import { chromium } from "playwright";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const steps = [];
const step = (k, v) => {
  const s = String(v);
  steps.push({ t: new Date().toISOString(), k, v: s.slice(0, 2000) });
  console.log("##", k, s.slice(0, 500));
};
const dump = (extra = {}) => {
  try {
    fs.mkdirSync("acp-attempt-out", { recursive: true });
    fs.writeFileSync("acp-attempt-out/result.json", JSON.stringify({ testnet: false, ...extra, steps }, null, 2));
  } catch (e) { console.log("DUMP-FAIL", String(e).slice(0, 200)); }
};
process.on("uncaughtException", (e) => { step("uncaught", String((e && e.stack) || e).slice(0, 1000)); dump(); process.exit(3); });
process.on("unhandledRejection", (e) => { step("unhandled", String((e && e.stack) || e).slice(0, 1000)); dump(); process.exit(3); });
const run = (cmd, args, extraEnv = {}, replaceEnv = false) => {
  try {
    const o = execFileSync(cmd, args, {
      encoding: "utf8", timeout: 180000,
      env: replaceEnv ? { ...extraEnv } : { ...process.env, ...extraEnv },
    });
    return { ok: true, out: o.slice(0, 4000) };
  } catch (e) {
    return { ok: false, code: e.status, out: String((e.stdout || "") + (e.stderr || "")).slice(0, 4000) };
  }
};

fs.mkdirSync("acp-shots", { recursive: true });
fs.mkdirSync("acp-attempt-out", { recursive: true });
step("script-version", "2d-provider-log");
dump({ burner: null });

const cleanBase = { PATH: process.env.PATH, HOME: process.env.HOME, USER: "runner", LANG: "C.UTF-8", npm_config_cache: process.env.HOME + "/.npm" };
const envMain = { ...cleanBase, ACP_CONFIG_DIR: process.cwd() + "/acp-home-main" };

step("install-acp-cli", JSON.stringify(run("npm", ["i", "-g", "@virtuals-protocol/acp-cli", "--no-audit", "--no-fund"])));
step("install-deps", JSON.stringify(run("npm", ["i", "--no-audit", "--no-fund", "viem"], { ...cleanBase, npm_config_cache: process.env.HOME + "/.npm" }, true)));
const { generatePrivateKey, privateKeyToAccount } = await import("viem/accounts");
const burnerPk = generatePrivateKey();
const burner = privateKeyToAccount(burnerPk);
step("burner", JSON.stringify({ address: burner.address }));

const sMain = run("acp", ["configure", "start", "--json"], envMain, true);
let urlMain = null, requestIdMain = null;
try {
  const j = JSON.parse((sMain.out.match(/\{[\s\S]*\}/) || ["{}"])[0]);
  urlMain = j.url || null; requestIdMain = j.requestId || null;
} catch (e) { step("parse-main-fail", String(e).slice(0, 200)); }
step("parsed-main", JSON.stringify({ host: urlMain ? new URL(urlMain).host : null, hasReq: !!requestIdMain }));
if (!urlMain) { step("fatal", "no auth url: " + JSON.stringify(sMain).slice(0, 300)); dump(); process.exit(2); }

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on("response", (r) => { if (r.status() >= 400) step("http-" + r.status(), r.url().slice(0, 160)); });

// bridge: dapp -> node signer (burner). personal_sign + typed-data.
await page.exposeFunction("__acpAccounts", () => [burner.address]);
await page.exposeFunction("__acpPersonalSign", async (hexMsg) => {
  return await burner.signMessage({ message: hexMsg });
});
await page.exposeFunction("__acpSignTyped", async (typedJson) => {
  const t = JSON.parse(typedJson);
  return await burner.signTypedData(t);
});
await page.addInitScript(() => {
  window.__acpCalls = [];
  const acc = () => window.__acpAccounts();
  const logCall = (method, params) => {
    try { window.__acpCalls.push(method + " " + JSON.stringify(params || []).slice(0, 160)); } catch (e) {}
  };
  const prov = {
    isMetaMask: true, isConnected: () => true, chainId: "0x2105", selectedAddress: null,
    request: async ({ method, params }) => {
      logCall(method, params);
      if (method === "eth_requestAccounts" || method === "eth_accounts") { prov.selectedAddress = (await acc())[0]; return acc(); }
      if (method === "eth_chainId" || method === "net_version") return "0x2105";
      if (method === "eth_coinbase") return (await acc())[0];
      if (method === "wallet_requestPermissions" || method === "wallet_getPermissions") return [{ parentCapability: "eth_accounts" }];
      if (method === "web3_clientVersion") return "MetaMask/v12.0.0";
      if (method === "personal_sign") {
        const [msg] = params;
        return window.__acpPersonalSign(msg);
      }
      if (method === "eth_signTypedData_v4" || method === "eth_signTypedData_v3" || method === "eth_signTypedData") {
        const [addr, typed] = params;
        return window.__acpSignTyped(typeof typed === "string" ? typed : JSON.stringify(typed));
      }
      if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") return null;
      if (method === "eth_blockNumber" || method === "eth_gasPrice") return "0x0";
      throw Object.assign(new Error("unsupported:" + method), { code: 4200 });
    },
    on() {}, removeListener() {}, emit() {}, send() {}, sendAsync() {},
  };
  window.ethereum = prov;
  // EIP-6963 announcement for discoverers
  const announce = () => {
    window.dispatchEvent(new CustomEvent("eip6963:announceProvider", {
      detail: Object.freeze({ info: { uuid: "acp-minibrowser", name: "MetaMask", icon: "", rdns: "io.metamask" }, provider: prov }),
    }));
  };
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
  window.dispatchEvent(new Event("ethereum#initialized"));
});

try {
  await page.goto(urlMain, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(5000);
  // dismiss cookie banner if present
  const opt = page.locator("button", { hasText: "Opt-out" });
  if (await opt.count()) { await opt.first().click().catch(() => {}); await page.waitForTimeout(1500); }
  // click in-card Login
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button")].filter((b) => b.innerText.trim() === "Login");
    const card = btns.find((b) => {
      let el = b.parentElement;
      for (let i = 0; i < 5 && el; i++) {
        if ((el.innerText || "").includes("EconomyOS Authentication")) return true;
        el = el.parentElement;
      }
      return false;
    }) || btns[btns.length - 1];
    if (card) card.click();
  });
  await page.waitForTimeout(6000);
  await page.screenshot({ path: "acp-shots/2-login-modal.png" });
  // click "Continue with a wallet"
  const wbtn = page.locator("button", { hasText: "Continue with a wallet" });
  if (await wbtn.count()) {
    await wbtn.first().click();
    await page.waitForTimeout(6000);
  } else step("no-wallet-option", "wallet button missing");
  const opts = await page.evaluate(() => ({
    buttons: [...document.querySelectorAll("button")].map((b) => b.innerText.trim()).filter(Boolean).slice(0, 40),
    text: document.body.innerText.slice(0, 1500),
  }));
  step("wallet-options", JSON.stringify(opts));
  await page.screenshot({ path: "acp-shots/2-wallet-options.png" });
  // try common injected-wallet entries
  for (const label of ["MetaMask", "Browser Wallet", "Injected", "Detected"]) {
    const c = page.locator("button", { hasText: label });
    if (await c.count()) {
      step("wallet-pick", label);
      await c.first().click();
      break;
    }
  }
  // wait for SIWE signature bridge activity: poll completes via CLI
  await page.waitForTimeout(8000);
  const calls = await page.evaluate(() => (window.__acpCalls || []).slice(0, 30));
  step("provider-calls", JSON.stringify(calls));
  await page.screenshot({ path: "acp-shots/2-after-sign.png" });
  const after = await page.evaluate(() => ({ text: document.body.innerText.slice(0, 1000) }));
  step("after-sign", JSON.stringify(after));
} catch (e) {
  step("browser-fail", String(e).slice(0, 800));
}
await browser.close();

// poll completion (server side sees the SIWE session)
const comp = run("acp", ["configure", "complete", "--request-id", requestIdMain, "--json"], envMain, true);
step("configure-complete", JSON.stringify(comp));
let authed = false, walletAddr = null;
try {
  const j = JSON.parse((comp.out.match(/\{[\s\S]*\}/) || ["{}"])[0]);
  authed = j.status === "authenticated";
  walletAddr = j.walletAddress || null;
} catch (e) {}
step("auth-result", JSON.stringify({ authed, walletAddr }));

if (authed) {
  step("agent-create", JSON.stringify(run("acp", ["agent", "create", "--name", "DoishyScout", "--description", "Autonomous bounty-triage scout: reads public boards, verifies claims, never sleeps.", "--json"], envMain, true)));
  step("signer-add", JSON.stringify(run("acp", ["agent", "add-signer", "--no-wait", "--json"], envMain, true)));
  step("browse", JSON.stringify(run("acp", ["browse", "--json"], envMain, true)).slice(0, 1500));
}

fs.writeFileSync("acp-attempt-out/result.json", JSON.stringify({ testnet: false, burner: burner.address, steps }, null, 2));
step("done", "result.json written");
