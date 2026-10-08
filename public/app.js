import { CONFIG } from "./config.js";
import { normalizeBody, countCharacters, validateBody, publicConfigReady } from "./validation.js";

const $ = (id) => document.getElementById(id);
const ready = publicConfigReady(CONFIG);
const endpoint = `${CONFIG.supabaseUrl.replace(/\/$/, "")}/functions/v1/good-things`;
const state = { cursor: null, loading: false, submitting: false, loaded: false, seen: new Set(), requestId: crypto.randomUUID(), report: null };
let visitorId;
let liked = new Set();
try {
  visitorId = localStorage.getItem("good-things:visitor");
  if (!/^[0-9a-f-]{36}$/i.test(visitorId || "")) {
    visitorId = crypto.randomUUID();
    localStorage.setItem("good-things:visitor", visitorId);
  }
  const saved = JSON.parse(localStorage.getItem("good-things:likes") || "[]");
  if (Array.isArray(saved)) liked = new Set(saved.filter(x => typeof x === "string").slice(-2000));
} catch { visitorId ||= crypto.randomUUID(); }

function showStatus(el, message, isError = false) {
  el.textContent = message;
  el.classList.toggle("error", isError);
}
function updateForm() {
  const size = countCharacters($("post-body").value);
  $("char-count").textContent = `${size} / 300`;
  $("char-count").classList.toggle("over-limit", size > 300);
  $("post-body").setAttribute("aria-invalid", String(size > 300));
  $("submit-post").disabled = !ready || state.submitting || size > 300 || !$("consent").checked || Boolean(validateBody($("post-body").value));
}
$("post-body").addEventListener("input", () => { state.requestId = crypto.randomUUID(); updateForm(); });
$("consent").addEventListener("change", updateForm);

async function api(method, payload, cursor = null) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  const url = new URL(endpoint);
  if (cursor) url.searchParams.set("cursor", cursor);
  try {
    const response = await fetch(url, {
      method, signal: controller.signal, cache: "no-store", credentials: "omit",
      headers: { apikey: CONFIG.publishableKey, ...(payload ? { "Content-Type": "application/json" } : {}) },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.message || "通信できませんでした。少し時間をおいてお試しください。");
      error.retryAfter = Number(response.headers.get("Retry-After")) || 0;
      throw error;
    }
    return data;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("通信に時間がかかっています。送信済みの可能性があります。そのまま再試行してください。");
    if (error instanceof TypeError) throw new Error("通信できませんでした。インターネット接続を確認して再試行してください。");
    throw error;
  } finally { clearTimeout(timer); }
}

let turnstileLoading;
function loadTurnstile() {
  if (window.turnstile) return Promise.resolve();
  if (!turnstileLoading) turnstileLoading = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    const timer = setTimeout(() => reject(new Error("安全確認を読み込めませんでした。ページを更新して再試行してください。")), 15000);
    script.onload = () => { clearTimeout(timer); resolve(); };
    script.onerror = () => { clearTimeout(timer); reject(new Error("安全確認を読み込めませんでした。接続を確認してください。")); };
    document.head.append(script);
  });
  return turnstileLoading;
}
let challenging = false;
async function challenge() {
  if (challenging) throw new Error("進行中の安全確認を完了してください。");
  challenging = true;
  try {
    await loadTurnstile();
    return await new Promise((resolve, reject) => {
      const dialog = $("challenge-dialog");
      let widget;
      let settled = false;
      let timer;
      const finish = (token, error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        dialog.removeEventListener("cancel", cancel);
        $("cancel-challenge").removeEventListener("click", cancel);
        if (widget !== undefined) window.turnstile.remove(widget);
        dialog.close();
        error ? reject(error) : resolve(token);
      };
      const cancel = (event) => { event.preventDefault(); finish(null, new Error("操作をキャンセルしました。")); };
      dialog.addEventListener("cancel", cancel);
      $("cancel-challenge").addEventListener("click", cancel);
      $("challenge-status").textContent = "";
      dialog.showModal();
      timer = setTimeout(() => finish(null, new Error("安全確認の時間が切れました。もう一度お試しください。")), 120000);
      try {
        widget = window.turnstile.render($("challenge-widget"), {
          sitekey: CONFIG.turnstileSiteKey, action: "write", language: "ja",
          callback: (token) => finish(token),
          "error-callback": () => { showStatus($("challenge-status"), "安全確認に失敗しました。再試行を待つかキャンセルしてください。", true); },
          "expired-callback": () => finish(null, new Error("安全確認の時間が切れました。")),
        });
      } catch { finish(null, new Error("安全確認を開始できませんでした。ページを更新してください。")); }
    });
  } finally { challenging = false; }
}
async function mutate(payload) {
  const token = await challenge();
  return api("POST", { ...payload, visitorId, token, website: $("website").value });
}

function renderPost(post, prepend = false) {
  if (state.seen.has(post.id)) return;
  state.seen.add(post.id);
  const article = document.createElement("article");
  article.className = "post-card card";
  const mark = document.createElement("span");
  mark.className = "post-mark";
  mark.textContent = "✳";
  mark.setAttribute("aria-hidden", "true");
  const body = document.createElement("p");
  body.className = "post-body";
  // 利用者の入力をHTMLに変換しません。
  body.textContent = post.body;
  const footer = document.createElement("div");
  footer.className = "post-footer";
  const time = document.createElement("time");
  time.className = "post-date";
  time.dateTime = post.created_at;
  time.textContent = new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tokyo" }).format(new Date(post.created_at));
  const actions = document.createElement("div");
  actions.className = "post-actions";
  const like = document.createElement("button");
  like.type = "button";
  like.className = "like-button";
  const paintLike = (count) => {
    const done = liked.has(post.id);
    like.textContent = `${done ? "♥" : "♡"} ${count}`;
    like.setAttribute("aria-label", `よかったね ${count}件${done ? "（送信済み）" : ""}`);
    like.setAttribute("aria-pressed", String(done));
    like.disabled = done;
  };
  paintLike(post.likes_count);
  const report = document.createElement("button");
  report.type = "button";
  report.className = "report-button";
  report.textContent = "通報";
  report.setAttribute("aria-label", "この投稿を通報する");
  const status = document.createElement("p");
  status.className = "card-status";
  status.setAttribute("role", "status");
  like.addEventListener("click", async () => {
    like.disabled = true;
    showStatus(status, "");
    try {
      const result = await mutate({ action: "like", postId: post.id });
      liked.add(post.id);
      try { localStorage.setItem("good-things:likes", JSON.stringify([...liked].slice(-2000))); } catch { /* サーバーの一意制約は引き続き有効 */ }
      paintLike(result.likes_count);
      showStatus(status, "よかったね、を届けました。");
    } catch (error) { like.disabled = false; showStatus(status, error.message, true); }
  });
  report.addEventListener("click", () => {
    state.report = { id: post.id, status };
    showStatus($("report-status"), "");
    $("report-reason").value = "personal";
    $("report-dialog").showModal();
  });
  actions.append(like, report);
  footer.append(time, actions);
  article.append(mark, body, footer, status);
  prepend ? $("posts").prepend(article) : $("posts").append(article);
}

async function loadPosts() {
  if (state.loading || !ready) return;
  state.loading = true;
  $("load-more").disabled = true;
  $("retry-feed").hidden = true;
  $("posts").setAttribute("aria-busy", "true");
  $("feed-status").hidden = false;
  showStatus($("feed-status"), "読み込み中です…");
  try {
    const data = await api("GET", null, state.cursor);
    for (const post of data.posts) renderPost(post);
    state.cursor = data.nextCursor;
    state.loaded = true;
    $("load-more").hidden = !state.cursor;
    $("feed-status").hidden = state.seen.size > 0;
    if (!state.seen.size) showStatus($("feed-status"), "まだ投稿がありません。最初の小さな「よかった」を残してみませんか。");
  } catch (error) {
    showStatus($("feed-status"), error.message, true);
    $("retry-feed").hidden = false;
  } finally {
    state.loading = false;
    $("load-more").disabled = false;
    $("posts").setAttribute("aria-busy", "false");
  }
}
$("load-more").addEventListener("click", loadPosts);
$("retry-feed").addEventListener("click", loadPosts);

$("post-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!ready || state.submitting) return;
  const error = validateBody($("post-body").value);
  if (error || !$("consent").checked) { showStatus($("post-status"), error || "規約への同意が必要です。", true); return; }
  state.submitting = true;
  $("post-body").disabled = true;
  $("consent").disabled = true;
  updateForm();
  showStatus($("post-status"), "投稿を送信しています…");
  try {
    const result = await mutate({ action: "post", body: normalizeBody($("post-body").value), requestId: state.requestId, consent: true });
    $("post-body").value = "";
    state.requestId = crypto.randomUUID();
    showStatus($("post-status"), "投稿できました。小さな「よかった」をありがとう。");
    renderPost(result.post, true);
    $("feed-status").hidden = true;
  } catch (error) { showStatus($("post-status"), error.message, true); }
  finally {
    state.submitting = false;
    $("post-body").disabled = false;
    $("consent").disabled = false;
    updateForm();
  }
});
$("cancel-report").addEventListener("click", () => $("report-dialog").close());
$("report-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const target = state.report;
  if (!target || $("submit-report").disabled) return;
  const reason = $("report-reason").value;
  $("submit-report").disabled = true;
  $("report-dialog").close();
  try {
    await mutate({ action: "report", postId: target.id, reason });
    showStatus(target.status, "運営に知らせました。ご協力ありがとうございます。");
  } catch (error) { showStatus(target.status, error.message, true); }
  finally { $("submit-report").disabled = false; }
});

if (CONFIG.contactUrl && /^https:\/\//.test(CONFIG.contactUrl)) $("contact-link").href = CONFIG.contactUrl;
if (ready) loadPosts();
else {
  $("setup-notice").hidden = false;
  showStatus($("feed-status"), "ただいま準備中です。接続設定が完了すると、ここにみんなの投稿が届きます。");
}
updateForm();
