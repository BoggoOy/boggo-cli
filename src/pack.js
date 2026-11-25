// Kansion paketointi julkaisua varten (boggo push): tar.gz ilman riippuvuuksia. Mukaan eivät tule .git, node_modules, .boggo,
// .env-tiedostot (paitsi esimerkit), rakennusten välimuistit, .gitignoren ja .boggoignoren tiedostot eikä yli 50 Mt:n tiedostot.
// Raja 100 Mt pakattuna (Boggo Cloudin raja, megatavu = 1 048 576 tavua). Portaali tarkistaa paketin samoilla säännöillä.
import { lstatSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import { join, posix } from "node:path";
import { createGzip } from "node:zlib";

export const MB = 1_048_576;
export const UPLOAD_MAX_BYTES = 100 * MB;
export const FILE_MAX_BYTES = 50 * MB;

// Aina pois: versionhallinta, riippuvuudet, Boggon oma kansio ja kehyksien välimuistit (rakennetaan Boggo Cloudissa uudelleen).
const ALWAYS_DIRS = new Set([".git", ".hg", ".svn", "node_modules", ".boggo", ".next", ".nuxt", ".output", ".svelte-kit", ".turbo", ".vercel", ".cache"]);
const ALWAYS_FILES = new Set([".DS_Store", "Thumbs.db"]);
// .env-tiedostot jäävät pois (salaisuudet), esimerkit kelpaavat.
const ENV_EXAMPLES = new Set([".env.example", ".env.sample", ".env.template", ".env.local.example", ".env.dist"]);
const isEnvFile = (name) => (name === ".env" || name.startsWith(".env.")) && !ENV_EXAMPLES.has(name);

// Tunnistuksen tiedostot, jotka lähetetään portaalille (boggo init): samat kuin portaalin säännöissä.
const DETECT_FILES = new Set(["package.json", "Dockerfile", "requirements.txt", "pyproject.toml"]);

// ---------------------------------------------------------------------------------------------------------
// .gitignore-säännöt (tavalliset muodot: kommentit, !, kansio/, /juuri, *, **, ?, [abc])

function patternRegex(body) {
  let re = "";
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "*") {
      if (body[i + 1] === "*") {
        const slashAfter = body[i + 2] === "/";
        re += slashAfter ? "(?:.*/)?" : ".*";
        i += slashAfter ? 2 : 1;
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else if (c === "[") {
      const end = body.indexOf("]", i + 1);
      if (end < 0) re += "\\[";
      else {
        re += `[${body.slice(i + 1, end).replace(/^!/, "^").replace(/\\/g, "\\\\")}]`;
        i = end;
      }
    } else if (c === "\\" && i + 1 < body.length) re += `\\${body[++i]}`;
    else re += /[.+^${}()|\\/]/.test(c) ? `\\${c}` : c;
  }
  return re;
}

// Yhden ignore-tiedoston säännöt kansiolle base ('' = juuri).
export function parseIgnore(text, base = "") {
  const rules = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.replace(/(?<!\\)\s+$/, "");
    if (!line || line.startsWith("#")) continue;
    const negate = line.startsWith("!");
    if (negate) line = line.slice(1);
    if (line.startsWith("\\#") || line.startsWith("\\!")) line = line.slice(1);
    const dirOnly = line.endsWith("/");
    if (dirOnly) line = line.slice(0, -1);
    const anchored = line.includes("/");
    if (line.startsWith("/")) line = line.slice(1);
    if (!line) continue;
    const body = patternRegex(line);
    const re = new RegExp(anchored ? `^${body}$` : `(?:^|/)${body}$`);
    rules.push({ base, re, negate, dirOnly });
  }
  return rules;
}

// Viimeinen osuva sääntö ratkaisee (kuten git). path on suhteellinen paketin juuresta.
export function ignored(rules, path, isDir) {
  let result = false;
  for (const r of rules) {
    if (r.dirOnly && !isDir) continue;
    let rel = path;
    if (r.base) {
      if (!path.startsWith(`${r.base}/`)) continue;
      rel = path.slice(r.base.length + 1);
    }
    if (r.re.test(rel)) result = !r.negate;
  }
  return result;
}

// ---------------------------------------------------------------------------------------------------------
// Kansion läpikäynti

// Tiedostot ja kansiot paketoitavaksi. Palauttaa entries [{ path, type: "file"|"dir"|"link", size, mode, mtime, link }],
// skipped (ohitetut isot tiedostot ja ulos osoittavat linkit) ja detect (tunnistuksen tiedostot sisältöineen).
export function collect(root) {
  const entries = [];
  const skipped = [];
  const detect = {};
  const readIgnore = (dir, rel) => {
    const out = [];
    for (const name of [".gitignore", ".boggoignore"]) {
      try {
        out.push(...parseIgnore(readFileSync(join(dir, name), "utf8"), rel));
      } catch {
        /* ei tiedostoa */
      }
    }
    return out;
  };
  const walk = (dir, rel, rules) => {
    const own = [...rules, ...readIgnore(dir, rel)];
    let names;
    try {
      names = readdirSync(dir).sort();
    } catch {
      return;
    }
    for (const name of names) {
      const path = rel ? `${rel}/${name}` : name;
      const full = join(dir, name);
      let st;
      try {
        st = lstatSync(full);
      } catch {
        continue;
      }
      const isDir = st.isDirectory();
      if (isDir && ALWAYS_DIRS.has(name)) continue;
      if (!isDir && (ALWAYS_FILES.has(name) || isEnvFile(name))) continue;
      if (ignored(own, path, isDir)) continue;
      if (st.isSymbolicLink()) {
        const target = readlinkSync(full);
        const resolved = posix.normalize(posix.join(posix.dirname(path), target));
        if (target.startsWith("/") || resolved === ".." || resolved.startsWith("../")) {
          skipped.push({ path, reason: "link" });
          continue;
        }
        entries.push({ path, type: "link", size: 0, mode: 0o777, mtime: st.mtimeMs, link: target });
      } else if (isDir) {
        entries.push({ path, type: "dir", size: 0, mode: 0o755, mtime: st.mtimeMs });
        walk(full, path, own);
      } else if (st.isFile()) {
        if (st.size > FILE_MAX_BYTES) {
          skipped.push({ path, reason: "size", size: st.size });
          continue;
        }
        entries.push({ path, type: "file", size: st.size, mode: st.mode & 0o111 ? 0o755 : 0o644, mtime: st.mtimeMs, full });
        if (DETECT_FILES.has(name) && path.split("/").length <= 4 && st.size <= 64 * 1024) detect[path] = readFileSync(full, "utf8");
      }
      // Muut (laitetiedostot, FIFOt, socketit) ohitetaan hiljaa.
    }
  };
  walk(root, "", []);
  return { entries, skipped, detect };
}

// ---------------------------------------------------------------------------------------------------------
// tar (ustar, pitkät nimet PAX-otsakkeella)

const enc = new TextEncoder();

function header(name, { size = 0, type = "0", mode = 0o644, mtime = 0, link = "" }) {
  const h = Buffer.alloc(512);
  const put = (s, at, len) => enc.encode(s).subarray(0, len).forEach((b, i) => (h[at + i] = b));
  const oct = (n, len) => n.toString(8).padStart(len - 1, "0") + "\0";
  put(name, 0, 100);
  put(oct(mode, 8), 100, 8);
  put(oct(0, 8), 108, 8);
  put(oct(0, 8), 116, 8);
  put(oct(size, 12), 124, 12);
  put(oct(Math.max(0, Math.floor(mtime / 1000)), 12), 136, 12);
  put("        ", 148, 8);
  put(type, 156, 1);
  put(link, 157, 100);
  put("ustar\0", 257, 6);
  put("00", 263, 2);
  let sum = 0;
  for (const b of h) sum += b;
  put(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8);
  return h;
}

const pad = (n) => Buffer.alloc((512 - (n % 512)) % 512);

function paxRecord(key, value) {
  const record = ` ${key}=${value}\n`;
  let len = Buffer.byteLength(record) + 1;
  while (String(len).length + Buffer.byteLength(record) !== len) len++;
  return `${len}${record}`;
}

// Merkinnän otsakkeet: pitkä nimi tai linkki PAX-tietueella, muuten pelkkä ustar.
function entryHeaders(e) {
  const name = e.type === "dir" ? `${e.path}/` : e.path;
  const type = e.type === "dir" ? "5" : e.type === "link" ? "2" : "0";
  const long = Buffer.byteLength(name) > 100 || (e.link && Buffer.byteLength(e.link) > 100);
  const out = [];
  if (long) {
    const pax = Buffer.from(paxRecord("path", name) + (e.link ? paxRecord("linkpath", e.link) : ""));
    out.push(header("PaxHeader", { size: pax.length, type: "x" }), pax, pad(pax.length));
  }
  out.push(header(long ? name.slice(0, 99) : name, { size: e.type === "file" ? e.size : 0, type, mode: e.mode, mtime: e.mtime, link: long ? "" : (e.link ?? "") }));
  return out;
}

// Paketoi merkinnät tar.gz-puskuriksi. Heittää virheen { code: "too_big" }, jos pakattu ylittää rajan.
export async function packEntries(entries, { max = UPLOAD_MAX_BYTES } = {}) {
  const gzip = createGzip({ level: 6 });
  const chunks = [];
  let size = 0;
  let tooBig = false;
  gzip.on("data", (c) => {
    size += c.length;
    if (size > max) tooBig = true;
    else chunks.push(c);
  });
  const done = new Promise((resolve, reject) => {
    gzip.on("end", resolve);
    gzip.on("error", reject);
  });
  const write = (buf) => (gzip.write(buf) ? Promise.resolve() : new Promise((r) => gzip.once("drain", r)));
  for (const e of entries) {
    if (tooBig) break;
    for (const h of entryHeaders(e)) await write(h);
    if (e.type === "file") {
      const data = readFileSync(e.full);
      // Tiedosto muuttui läpikäynnin jälkeen: otsakkeen koko ratkaisee (katkaistaan tai täytetään).
      const body = data.length === e.size ? data : Buffer.concat([data.subarray(0, e.size), Buffer.alloc(Math.max(0, e.size - data.length))]);
      await write(body);
      await write(pad(e.size));
    }
  }
  gzip.end(Buffer.alloc(1024));
  await done;
  if (tooBig) throw Object.assign(new Error("too_big"), { code: "too_big" });
  return Buffer.concat(chunks);
}

// Tavut tekstinä, esim. 12,4 Mt / 12.4 MB.
export function sizeText(n, lang = "fi") {
  const unit = lang === "fi" ? ["kt", "Mt"] : ["kB", "MB"];
  if (n < MB) return `${Math.max(1, Math.round(n / 1024))} ${unit[0]}`;
  const v = (n / MB).toFixed(1);
  return `${lang === "fi" ? v.replace(".", ",") : v} ${unit[1]}`;
}
