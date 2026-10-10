// 自動生成ファイル。編集元はpublic/validation.jsとsupabase/functions/good-things/index.tsです。
// Supabase Dashboardのindex.tsに全文を貼り付けて公開できます。秘密値は含みません。

function normalizeBody(value) {
  return typeof value === "string" ? value.normalize("NFC").replace(/\r\n?/g, "\n").trim() : "";
}
function countCharacters(value) { return Array.from(value.normalize("NFC")).length; }
function validateBody(value) {
  const body = normalizeBody(value);
  if (!body.replace(/[\s\u200B-\u200D\u2060\uFEFF]/gu, "")) return "話したいことを入力してください。";
  if (countCharacters(body) > 300) return "300文字以内で入力してください。";
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(body)) return "使えない制御文字が含まれています。";
  return "";
}
function publicConfigReady(config) {
  if (typeof config.publishableKey !== "string") return false;
  if (config.publishableKey.split(".").length === 3) {
    try {
      const payload = JSON.parse(atob(config.publishableKey.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      if (payload.role !== "anon") return false;
    } catch { return false; }
  }
  return /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(config.supabaseUrl)
    && Boolean(config.publishableKey && config.turnstileSiteKey)
    && !/sb_secret_|service_role/i.test(config.publishableKey);
}

const env = (name: string) => Deno.env.get(name) || "";
const supabaseUrl = env("SUPABASE_URL");
const serviceKey = env("GOOD_THINGS_SERVER_KEY") || env("SUPABASE_SERVICE_ROLE_KEY");
const origins = env("ALLOWED_ORIGINS").split(",").map(x => x.trim()).filter(Boolean);
const hostnames = env("TURNSTILE_HOSTNAMES").split(",").map(x => x.trim()).filter(Boolean);
const secret = env("TURNSTILE_SECRET_KEY");
const hashSecret = env("ABUSE_HASH_SECRET");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const safeMessages: Record<string, [number, string]> = {
  rate_limited: [429, "操作が続いています。しばらく時間をおいてからお試しください。"],
  invalid_input: [400, "入力内容を確認してください。"],
  duplicate_body: [409, "同じ内容はすでに投稿されています。"],
  post_unavailable: [404, "この投稿は現在表示できません。ページを更新してください。"],
};
class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
async function hash(value: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(hashSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, "0")).join("");
}
async function rpc(name: string, body: Record<string, unknown>) {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
    method: "POST", signal: AbortSignal.timeout(10000),
    headers: { "Content-Type": "application/json", apikey: serviceKey,
      ...(serviceKey.startsWith("sb_secret_") ? {} : { Authorization: `Bearer ${serviceKey}` }) },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) {
    const safe = safeMessages[data.message];
    if (safe) throw new ApiError(...safe);
    // 投稿本文・IP・トークン・DBの内部エラーはログに出しません。
    console.error("database_request_failed", response.status);
    throw new ApiError(503, "ただいま接続できません。時間をおいてお試しください。");
  }
  return data;
}
async function readBody(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new ApiError(415, "JSON形式で送信してください。");
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "入力内容を確認してください。");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 8192) { await reader.cancel(); throw new ApiError(413, "送信内容が大きすぎます。"); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("invalid");
    return data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "入力内容を確認してください。");
  } finally { reader.releaseLock(); }
}
async function verifyChallenge(token: unknown) {
  if (typeof token !== "string" || !token || token.length > 2048) throw new ApiError(400, "安全確認をやり直してください。");
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST", signal: AbortSignal.timeout(8000),
    body: new URLSearchParams({ secret, response: token }),
  });
  if (!response.ok) throw new ApiError(503, "安全確認サービスに接続できません。");
  const result = await response.json();
  if (!result.success || result.action !== "write" || !hostnames.includes(result.hostname)) {
    throw new ApiError(403, "安全確認が完了しませんでした。もう一度お試しください。");
  }
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("origin") || "";
  const allowed = origins.includes(origin);
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex, nofollow, nosnippet",
    "Vary": "Origin", "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "apikey, content-type", "Access-Control-Expose-Headers": "Retry-After",
  };
  if (allowed) headers["Access-Control-Allow-Origin"] = origin;
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
  try {
    if (!supabaseUrl || !serviceKey || !secret || hashSecret.length < 32 || !origins.length || !hostnames.length) throw new ApiError(503, "ただいま準備中です。");
    if (!allowed) throw new ApiError(403, "この接続元からは利用できません。");
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (!["GET", "POST"].includes(request.method)) {
      headers.Allow = "GET, POST, OPTIONS";
      throw new ApiError(405, "この操作は利用できません。");
    }
    // Supabaseのホストされたゲートウェイから届く情報。追加防御であり、本人認証には使いません。
    // ヘッダーが欠落した場合も共通バケットで制限を維持します。
    const forwarded = request.headers.get("x-forwarded-for") || "";
    const ip = forwarded.split(",")[0].trim().slice(0, 128) || "unknown-shared";
    const ipHash = await hash(`ip:${ip}`);
    if (request.method === "GET") {
      const raw = new URL(request.url).searchParams.get("cursor");
      let cursor: { time: string; id: string } | null = null;
      if (raw) {
        try {
          if (raw.length > 256) throw new Error();
          cursor = JSON.parse(atob(raw));
          if (!cursor || typeof cursor.time !== "string" || !Number.isFinite(Date.parse(cursor.time)) || !uuid.test(cursor.id)) throw new Error();
        } catch { throw new ApiError(400, "読み込み位置が無効です。ページを更新してください。"); }
      }
      const rows = await rpc("good_things_list", { p_ip: ipHash, p_before_time: cursor?.time ?? null, p_before_id: cursor?.id ?? null });
      const posts = rows.slice(0, 20);
      const last = posts.at(-1);
      const nextCursor = rows.length > 20 && last ? btoa(JSON.stringify({ time: last.created_at, id: last.id })) : null;
      return reply(200, { posts, nextCursor, features: { views: true } });
    }
    const data = await readBody(request);
    if (data.website !== "" || !uuid.test(data.visitorId || "") || !["post", "like", "report", "view"].includes(data.action)) throw new ApiError(400, "入力内容を確認してください。");
    const payload: Record<string, unknown> = { p_action: data.action, p_actor: await hash(`visitor:${data.visitorId}`), p_ip: ipHash };
    if (data.action === "post") {
      if (data.consent !== true || typeof data.body !== "string" || !uuid.test(data.requestId || "")) throw new ApiError(400, "入力と規約への同意を確認してください。");
      const error = validateBody(data.body);
      if (error) throw new ApiError(400, error);
      const body = normalizeBody(data.body);
      // 完全な個人情報・中傷判定ではありません。明白な連絡先と宣伝URLだけを抑止します。
      if (/(?:https?:\/\/|www\.)\S+|[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:\+?\d[\d ()-]{8,}\d)/i.test(body)) {
        throw new ApiError(400, "URL・メールアドレス・電話番号のような情報は投稿できません。");
      }
      payload.p_body = body;
      payload.p_request = data.requestId;
    } else {
      if (!uuid.test(data.postId || "")) throw new ApiError(400, "投稿が見つかりません。");
      payload.p_post = data.postId;
      if (data.action === "report") {
        if (!["personal", "abuse", "spam", "other"].includes(data.reason)) throw new ApiError(400, "通報理由を選んでください。");
        payload.p_reason = data.reason;
      }
    }
    // 閲覧は全文を開いた操作のみ。本人の人数は保証せず、DB制限と一意制約で抑止。
    // 投稿・いいね・通報のTurnstile必須検証は維持します。
    if (data.action !== "view") await verifyChallenge(data.token);
    return reply(200, await rpc("good_things_write", payload));
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 429) headers["Retry-After"] = "60";
      return reply(error.status, { message: error.message });
    }
    console.error("request_failed");
    return reply(503, { message: "ただいま接続できません。時間をおいてお試しください。" });
  }
});
