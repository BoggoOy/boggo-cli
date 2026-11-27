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

/**
 * Paketin lähetyksen aikaraja koosta: 2 min + koko 64 kt/s:n nopeudella, vähintään 5 min ja enintään 40 min. Kiinteä 5 min katkaisi
 * hitaalla yhteydellä isonkin, mutta sallitun (100 Mt) paketin kesken lähetyksen.
 */
export function uploadTimeoutMs(bytes) {
  return Math.min(40 * 60_000, Math.max(5 * 60_000, Math.round(120_000 + (bytes / (64 * 1024)) * 1000)));
}

export const deviceName = () => hostname().slice(0, 100) || "Komentorivi";

export class ApiError extends Error {
  constructor(status, message, data = {}) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

// Paketti virtana paloittain, jotta lähetetty määrä tiedetään (onProgress). Content-Length annetaan itse, joten pyyntö on
// tavuilleen sama kuin puskurina lähetetty (ei chunked-siirtoa).
const UPLOAD_CHUNK = 256 * 1024;

function progressBody(buf, onProgress) {
  let sent = 0;
  return new ReadableStream(
    {
      pull(controller) {
        if (sent >= buf.length) return controller.close();
        const part = buf.subarray(sent, sent + UPLOAD_CHUNK);
        sent += part.length;
        controller.enqueue(part);
        onProgress(sent);
      },
    },
    { highWaterMark: 0 },
  );
}

// Kutsu portaaliin. body: olio (JSON) tai Buffer (paketti; onProgress(lähetetyt tavut) kertoo etenemisen). Virhe: ApiError
// portaalin selkokielisellä viestillä.
// Tunnus kulkee vain salattuna: http:// kelpaa ainoastaan omalla koneella (portaalin kehitys).
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

export async function call(ctx, method, path, { body, org, query, timeoutMs = 60_000, fetchImpl = fetch, onProgress } = {}) {
  let url;
  try {
    url = new URL(`${ctx.portal}${path}`);
  } catch {
    throw new ApiError(0, ctx.t.badPortalUrl(ctx.portal));
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOOPBACK.has(url.hostname))) throw new ApiError(0, ctx.t.badPortalUrl(ctx.portal));
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
  const headers = { Accept: "application/json", "User-Agent": `boggo-cli/${ctx.version}` };
  if (ctx.token) headers.Authorization = `Bearer ${ctx.token}`;
  if (org) headers["X-Boggo-Organisaatio"] = org;
  let payload;
  let duplex;
  if (Buffer.isBuffer(body)) {
    headers["Content-Type"] = "application/gzip";
    payload = body;
    if (onProgress) {
      headers["Content-Length"] = String(body.length);
      payload = progressBody(body, onProgress);
      duplex = "half";
    }
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetchImpl(url, { method, headers, body: payload, duplex, signal: AbortSignal.timeout(timeoutMs), redirect: "error" });
  } catch (error) {
    // Aikaraja on eri asia kuin katkos: pyyntö voi olla jo perillä (esim. julkaisu alkanut), joten kutsuja kertoo sen erikseen.
    if (error?.name === "TimeoutError") throw new ApiError(0, ctx.t.timedOut(ctx.portal), { timeout: true });
    throw new ApiError(0, ctx.t.noConnection(ctx.portal));
  }
  const data = await res.json().catch(() => ({}));
  if (res.ok) return { status: res.status, data };
  const message = typeof data.error === "string" ? data.error : ctx.t.httpFailed(res.status);
  throw new ApiError(res.status, res.status === 401 && data.login ? ctx.t.loginAgain : message, data);
}
