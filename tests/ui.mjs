import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../scripts/serve.mjs";

const server = createServer();
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const address = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {}) });
const results = [];
const record = name => { results.push(name); console.log("PASS", name); };
await mkdir("test-results", { recursive: true });
try {
  for (const [label, viewport] of [["desktop", { width: 1440, height: 1100 }], ["mobile", { width: 390, height: 844 }]]) {
    const context = await browser.newContext({ viewport, reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/config.js", route => route.fulfill({ contentType: "text/javascript", body: 'export const CONFIG = { supabaseUrl: "", publishableKey: "", turnstileSiteKey: "", siteUrl: "", contactUrl: "", operatorName: "" };' }));
    await page.goto(address);
    await page.locator("#setup-notice").waitFor({ state: "visible" });
    assert.equal(await page.locator("#submit-post").isDisabled(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: `test-results/${label}-preview.png`, fullPage: true });
    record(`${label}: 未設定の準備中表示・投稿停止・横はみ出しなし`);
    const posts = Array.from({ length: 41 }, (_, i) => ({
      id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
      body: i === 0 ? '<img src=x onerror="window.xssExecuted=true"> ありがとう。' : `小さなよかった ${i + 1}。温かいごはんがおいしかった。`,
      created_at: new Date(Date.UTC(2026, 9, 8, 12, 0, -i)).toISOString(), likes_count: i % 4,
    }));
    const likes = new Set();
    const reports = [];
    let failNext = false;
    const api = "https://fixture.supabase.co/functions/v1/good-things";
    await page.route("**/config.js", route => route.fulfill({ contentType: "text/javascript", body: `export const CONFIG = ${JSON.stringify({ supabaseUrl: "https://fixture.supabase.co", publishableKey: "sb_publishable_test-placeholder", turnstileSiteKey: "test-placeholder", siteUrl: "", contactUrl: "", operatorName: "test" })}` }));
    await page.route("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit", route => route.fulfill({ contentType: "text/javascript", body: 'window.turnstile = { render(node, options) { node.textContent="テスト用の安全確認"; setTimeout(()=>options.callback("test-placeholder"),50); return "widget"; }, remove() { document.getElementById("challenge-widget").replaceChildren(); } };' }));
    await page.route(`${api}**`, async route => {
      const req = route.request();
      const headers = { "Access-Control-Allow-Origin": address, "Access-Control-Allow-Headers": "apikey, content-type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
      if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
      if (failNext) { failNext = false; return route.fulfill({ status: 503, headers, json: { message: "テスト用の通信エラー" } }); }
      await new Promise(resolve => setTimeout(resolve, 80));
      if (req.method() === "GET") {
        const offset = Number(new URL(req.url()).searchParams.get("cursor")) || 0;
        return route.fulfill({ headers, json: { posts: posts.slice(offset, offset + 20), nextCursor: offset + 20 < posts.length ? String(offset + 20) : null } });
      }
      const data = req.postDataJSON();
      if (data.action === "post") {
        const post = { id: crypto.randomUUID(), body: data.body, created_at: new Date().toISOString(), likes_count: 0 };
        posts.unshift(post);
        return route.fulfill({ headers, json: { post } });
      }
      const post = posts.find(x => x.id === data.postId);
      if (data.action === "like") {
        const key = `${data.visitorId}:${data.postId}`;
        if (!likes.has(key)) { post.likes_count++; likes.add(key); }
        return route.fulfill({ headers, json: { likes_count: post.likes_count } });
      }
      reports.push(data);
      return route.fulfill({ headers, json: { ok: true } });
    });
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll(".post-card").length === 20);
    assert.equal(await page.locator("#posts img").count(), 0);
    assert.equal(await page.evaluate(() => window.xssExecuted), undefined);
    assert.match(await page.locator(".post-body").first().textContent(), /<img/);
    record(`${label}: 20件表示・投稿HTMLを文字として表示（XSS防止）`);
    await page.locator("#post-body").fill("　\n　");
    await page.locator("#consent").check();
    assert.equal(await page.locator("#submit-post").isDisabled(), true);
    await page.locator("#post-body").fill("あ".repeat(301));
    assert.equal(await page.locator("#char-count").textContent(), "301 / 300");
    assert.equal(await page.locator("#submit-post").isDisabled(), true);
    await page.locator("#post-body").fill("朝の空がきれいだった。😊");
    await page.locator("#submit-post").click();
    await page.waitForFunction(() => document.getElementById("post-status").textContent.includes("投稿できました"));
    assert.equal(await page.locator("#post-body").inputValue(), "");
    assert.equal(await page.locator(".post-body").first().textContent(), "朝の空がきれいだった。😊");
    record(`${label}: 空白と301文字を拒否・投稿完了・一覧に即反映`);
    const firstLike = page.locator(".like-button").first();
    await firstLike.click();
    await page.waitForFunction(() => document.querySelector(".like-button").getAttribute("aria-pressed") === "true");
    assert.equal(await firstLike.textContent(), "♥ 1");
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll(".post-card").length === 20);
    assert.equal(await page.locator(".post-body").first().textContent(), "朝の空がきれいだった。😊");
    assert.equal(await page.locator(".like-button").first().textContent(), "♥ 1");
    assert.equal(await page.locator(".like-button").first().isDisabled(), true);
    record(`${label}: 再読み込み後もAPI応答の投稿といいねを表示・重複ボタン停止`);
    await page.locator(".report-button").first().click();
    await page.locator("#report-reason").selectOption("personal");
    await page.locator("#submit-report").click();
    await page.waitForFunction(() => document.querySelector(".card-status").textContent.includes("運営に知らせました"));
    assert.equal(reports.length, 1);
    record(`${label}: 理由選択から通報の送信完了まで`);
    failNext = true;
    await page.locator("#load-more").click();
    await page.locator("#retry-feed").waitFor({ state: "visible" });
    assert.equal(await page.locator(".post-card").count(), 20);
    await page.locator("#retry-feed").click();
    await page.waitForFunction(() => document.querySelectorAll(".post-card").length === 40);
    await page.locator("#load-more").click();
    await page.waitForFunction(() => document.querySelectorAll(".post-card").length === 42);
    assert.equal(await page.locator("#load-more").isHidden(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    record(`${label}: 読み込みエラー・再試行・もっと見る・末尾処理`);
    await page.screenshot({ path: `test-results/${label}-connected-fixture.png`, fullPage: true });
    assert.deepEqual(errors, []);
    await context.close();
  }
  await writeFile("test-results/ui-report.json", JSON.stringify({ passed: results, api: "fixture (Supabase実環境ではない)", browser: "Chromium", screenshots: ["desktop-preview.png", "mobile-preview.png"] }, null, 2));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
