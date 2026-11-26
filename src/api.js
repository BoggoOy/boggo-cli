// Boggo Cloudin portaalin rajapinta CLI:lle (portaalin src/app/api/cli). Tunnus: BOGGO_TOKEN (CI) tai ~/.boggo/tunnus.json.
// Portaalin osoite: BOGGO_URL tai https://cloud.boggo.fi. Tunnusta ei koskaan tulosteta.
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { configDir } from "./config.js";
import { SITE_URL } from "./messages.js";

export const TOKEN_RE = /^boggo_[A-Za-z0-9_-]{43}$/;

export function portalUrl(env) {
  return (env.BOGGO_URL?.trim() || SITE_URL).replace(/\/+$/, "");
}

const tokenPath = (home) => join(configDir(home), "tunnus.json");

// Tallennettu kirjautuminen { tunnus, portaali, sahkoposti }; null = ei kirjautunut. BOGGO_TOKEN ohittaa.
// Virheellinen BOGGO_TOKEN ei ole sama kuin "ei kirjautunut": { env: true, invalid: true }, jotta käyttäjälle voidaan kertoa
// oikea syy (muuten boggo login onnistuisi, mutta muuttuja peittäisi tallennetun tunnuksen edelleen).
export function readLogin(home, env) {
  if (env.BOGGO_TOKEN) return TOKEN_RE.test(env.BOGGO_TOKEN.trim()) ? { tunnus: env.BOGGO_TOKEN.trim(), portaali: portalUrl(env), env: true } : { env: true, invalid: true };
  try {
    const v = JSON.parse(readFileSync(tokenPath(home), "utf8"));
    if (!TOKEN_RE.test(v?.tunnus ?? "")) return null;
    // Eri portaalin tunnus (esim. testiympäristö) ei kelpaa toiseen.
    if (v.portaali && v.portaali !== portalUrl(env)) return null;
    return v;
  } catch {
    return null;
  }
}

export function saveLogin(home, login) {
  const dir = configDir(home);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const file = tokenPath(home);
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(login, null, 2) + "\n", { mode: 0o600 });
  chmodSync(temp, 0o600);
  renameSync(temp, file);
}

export function deleteLogin(home) {
  rmSync(tokenPath(home), { force: true });
}

export const deviceName = () => hostname().slice(0, 100) || "Komentorivi";

export class ApiError extends Error {
  constructor(status, message, data = {}) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

// Kutsu portaaliin. body: olio (JSON) tai Buffer (paketti). Virhe: ApiError portaalin selkokielisellä viestillä.
export async function call(ctx, method, path, { body, org, query, timeoutMs = 60_000, fetchImpl = fetch } = {}) {
  const url = new URL(`${ctx.portal}${path}`);
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
  const headers = { Accept: "application/json", "User-Agent": `boggo-cli/${ctx.version}` };
  if (ctx.token) headers.Authorization = `Bearer ${ctx.token}`;
  if (org) headers["X-Boggo-Organisaatio"] = org;
  let payload;
  if (Buffer.isBuffer(body)) {
    headers["Content-Type"] = "application/gzip";
    payload = body;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetchImpl(url, { method, headers, body: payload, signal: AbortSignal.timeout(timeoutMs), redirect: "error" });
  } catch {
    throw new ApiError(0, ctx.t.noConnection(ctx.portal));
  }
  const data = await res.json().catch(() => ({}));
  if (res.ok) return { status: res.status, data };
  const message = typeof data.error === "string" ? data.error : ctx.t.httpFailed(res.status);
  throw new ApiError(res.status, res.status === 401 && data.login ? ctx.t.loginAgain : message, data);
}
