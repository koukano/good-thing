export function normalizeBody(value) {
  return typeof value === "string" ? value.normalize("NFC").replace(/\r\n?/g, "\n").trim() : "";
}
export function countCharacters(value) { return Array.from(value.normalize("NFC")).length; }
export function validateBody(value) {
  const body = normalizeBody(value);
  if (!body.replace(/[\s\u200B-\u200D\u2060\uFEFF]/gu, "")) return "話したいことを入力してください。";
  if (countCharacters(body) > 300) return "300文字以内で入力してください。";
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(body)) return "使えない制御文字が含まれています。";
  return "";
}
export function publicConfigReady(config) {
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
