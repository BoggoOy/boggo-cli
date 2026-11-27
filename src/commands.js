// Komennot, jotka puhuvat Boggo Cloudin kanssa: login, logout, whoami, projects, init, link, push, promote ja open.
// Kulku uudelle projektille: boggo login → boggo init (uusi projekti tai olemassa oleva) → boggo push --prod.
// Tekstit: src/command-texts.js (suomi ja englanti).
import { spawn } from "node:child_process";
import { ApiError, call, deleteLogin, deviceName, portalUrl, readLogin, saveLogin, TOKEN_RE, uploadTimeoutMs } from "./api.js";
import { CMD } from "./command-texts.js";
import { lineReader } from "./lang.js";
import { SITE_URL } from "./messages.js";
import { highlight, painter, safe } from "./paint.js";
import { readLink, saveLink, suggestName } from "./link.js";
import { collect, packEntries, sizeText, UPLOAD_MAX_BYTES } from "./pack.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Yhteinen tila: tekstit, tulosteet, kysymykset ja portaali.
export function context(io, lang, args, version) {
  const t = CMD[lang];
  const login = readLogin(io.home, io.env);
  const ci = Boolean(io.env.CI && io.env.CI !== "false" && io.env.CI !== "0");
  const interactive = Boolean(io.stdin.isTTY && io.stderr.isTTY) && !ci;
  // Elävä rivi (pyörivä merkki, aika, edistymispalkki) vain päätteeseen: CI:n lokiin, putkeen ja tiedostoon tavalliset rivit.
  const animate = Boolean(io.stderr.isTTY) && io.env.TERM !== "dumb" && !ci;
  let lines = null;
  // Värit erikseen kummallekin virralle (putki tai tiedosto saa pelkän tekstin). blank: viimeisin rivi oli tyhjä, jotta gap()
  // ei koskaan tulosta kahta tyhjää riviä peräkkäin.
  const c = painter(io.stderr, io.env);
  const o = painter(io.stdout, io.env);
  let blank = false;
  let live = null;
  const CLEAR = "\r\u001b[2K";
  // Tavallinen rivi elävän rivin aikana: elävä rivi pyyhitään, rivi kirjoitetaan ja elävä piirretään sen alle uudelleen.
  const write = (stream, paint, s) => {
    if (live) io.stderr.write(CLEAR);
    stream.write(`${highlight(paint, safe(s))}\n`);
    blank = s === "";
    live?.draw();
  };
  const ctx = {
    t,
    lang,
    io,
    args,
    version,
    portal: portalUrl(io.env),
    token: login?.tunnus ?? null,
    login,
    interactive,
    cwd: io.cwd ?? process.cwd(),
    fetch: io.fetch ?? fetch,
    sleep: io.sleep ?? sleep,
    now: io.now ?? Date.now,
    c,
    o,
    out: (s = "") => write(io.stdout, o, s),
    err: (s = "") => write(io.stderr, c, s),
    // Koneluettava tuloste (--json) sellaisenaan.
    raw: (s) => io.stdout.write(`${s}\n`),
    // Tyhjä rivi osien väliin (stderr, joten stdoutin skriptikäyttö ei muutu).
    gap() {
      if (blank) return;
      if (live) io.stderr.write(CLEAR);
      io.stderr.write("\n");
      blank = true;
      live?.draw();
    },
    // Elävä rivi: render() palauttaa tekstin, joka piirretään pyörivän merkin perään 10 kertaa sekunnissa. null = ei päätettä
    // (kutsuja tulostaa tavalliset rivit). Rivi pyyhitään stopLive()lla; runCommand pysäyttää sen aina myös virheessä.
    startLive(render, { indent = "" } = {}) {
      if (!animate) return null;
      ctx.stopLive();
      const frames = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
      let i = 0;
      const handle = {
        draw: () => io.stderr.write(`${CLEAR}${indent}${highlight(c, safe(`${c.cyan(frames[i++ % frames.length])} ${render()}`))}`),
      };
      handle.timer = setInterval(handle.draw, 100);
      handle.timer.unref?.();
      live = handle;
      handle.draw();
      return handle;
    },
    stopLive() {
      if (!live) return;
      clearInterval(live.timer);
      live = null;
      io.stderr.write(CLEAR);
    },
    async ask(question, fallback = "") {
      lines ??= lineReader(io.stdin);
      io.stderr.write(safe(`${c.bold(question)}${fallback ? c.dim(` (${fallback})`) : ""}: `));
      blank = false;
      const line = await lines.next();
      if (line === null) throw new UserError(t.inputEnded);
      return line.trim() || fallback;
    },
    // Valinta numerolla; Enter = oletus.
    async choose(question, options, def = 0) {
      ctx.gap();
      io.stderr.write(`${c.bold(question)}\n`);
      options.forEach((opt, i) => io.stderr.write(safe(`  ${c.cyan(`${i + 1})`)} ${opt}${i === def ? ` ${c.dim(t.defaultMark)}` : ""}\n`)));
      for (;;) {
        const v = await ctx.ask(">", String(def + 1));
        const n = Number(v);
        if (Number.isInteger(n) && n >= 1 && n <= options.length) return n - 1;
        io.stderr.write(`${t.pickNumber(options.length)}\n`);
      }
    },
    async confirm(question) {
      const v = (await ctx.ask(`${question} [${t.yesNo}]`, t.yes)).toLowerCase();
      return v === t.yes.toLowerCase() || v === "y" || v === "k" || v === "yes" || v === "kyllä";
    },
    close: () => lines?.close(),
    api: (method, path, opts = {}) => call({ portal: ctx.portal, token: ctx.token, version, t }, method, path, { fetchImpl: ctx.fetch, ...opts }),
  };
  return ctx;
}

// Käyttäjälle näytettävä virhe ilman pinoa.
class UserError extends Error {}

export async function runCommand(ctx, command) {
  ctx.gap();
  try {
    switch (command) {
      case "login":
        return await login(ctx);
      case "logout":
        return await logout(ctx);
      case "whoami":
        return await whoami(ctx);
      case "projects":
        return await projects(ctx);
      case "init":
        return await init(ctx);
      case "link":
        return await link(ctx);
      case "push":
        return await push(ctx);
      case "promote":
        return await promote(ctx);
      case "open":
        return await open(ctx);
      default:
        throw new UserError(ctx.t.unknown(command));
    }
  } catch (e) {
    ctx.stopLive();
    if (e instanceof UserError || e instanceof ApiError) {
      ctx.gap();
      ctx.err(`${ctx.c.red(ctx.c.bold(ctx.t.errorMark))} ${e.message}`);
      return 1;
    }
    throw e;
  } finally {
    ctx.stopLive();
    ctx.gap();
    ctx.close();
  }
}

const warn = (ctx, text) => ctx.err(`${ctx.c.yellow(ctx.c.bold(ctx.t.warnMark))} ${text}`);
const done = (ctx, text) => ctx.out(`${ctx.o.green("✓")} ${ctx.o.bold(text)}`);

function requireLogin(ctx) {
  if (ctx.login?.invalid) throw new UserError(ctx.t.tokenInvalid);
  if (!ctx.token) throw new UserError(ctx.t.notLoggedIn);
}

// ---------------------------------------------------------------------------------------------------------
// login, logout, whoami

// Selaimen avauskomento. Windowsissa ei cmd /c start: cmd tulkitsee osoitteen &-merkin komentojen erottimeksi, joten osoite
// katkeaisi ja loppu ajettaisiin komentona. rundll32 saa osoitteen yhtenä argumenttina.
export function browserCommand(platform, url) {
  if (platform === "darwin") return ["open", [url]];
  if (platform === "win32") return ["rundll32", ["url.dll,FileProtocolHandler", url]];
  return ["xdg-open", [url]];
}

function openBrowser(ctx, url) {
  if (ctx.io.env.BOGGO_NO_BROWSER || !ctx.interactive) return false;
  // Osoite voi tulla kansion .boggo-tiedostosta tai portaalista: vain verkko-osoitteet, ei file:// eikä muita ohjelmia avaavia.
  if (!/^https?:\/\/\S+$/i.test(url)) return false;
  const [cmd, args] = browserCommand(process.platform, url);
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

// Kirjautumisen reitit eivät vaadi kirjautumista eivätkä koskaan vastaa 401, 404 tai 405 (portaalin src/app/api/cli/laite).
// Sellainen vastaus tulee siis jostain muusta kuin CLI-rajapinnasta: portaalissa ei vielä ole komentoriviä (sen kirjautumis-
// tarkistus vastaa "Kirjaudu sisään."), tai BOGGO_URL osoittaa väärään paikkaan. Portaalin omat virheet (429, 410, 503) näytetään.
const NOT_CLI_STATUSES = [401, 404, 405];

function cliNotSupported(ctx) {
  const { t } = ctx;
  return new UserError(`${t.cliNotSupported(ctx.portal)}${ctx.portal !== SITE_URL ? ` ${t.checkPortalUrl}` : ""}`);
}

async function loginApi(ctx, path, body) {
  try {
    return await ctx.api("POST", path, { body });
  } catch (e) {
    if (e instanceof ApiError && NOT_CLI_STATUSES.includes(e.status)) throw cliNotSupported(ctx);
    throw e;
  }
}

async function login(ctx) {
  const { t } = ctx;
  if (ctx.login?.env) throw new UserError(ctx.login.invalid ? t.tokenInvalid : t.tokenFromEnv);
  ctx.token = null;
  const { data: start } = await loginApi(ctx, "/api/cli/laite", { nimi: deviceName() });
  // Vastaus ilman laitekoodia ei ole CLI-rajapinnan (esim. HTML-sivu tilakoodilla 200).
  if (typeof start.laitekoodi !== "string" || typeof start.kayttajakoodi !== "string" || typeof start.osoite !== "string") throw cliNotSupported(ctx);
  ctx.err(t.loginOpen);
  ctx.gap();
  ctx.err(`  ${ctx.c.underline(start.osoite)}`);
  ctx.gap();
  ctx.err(t.loginCode(ctx.c.bold(start.kayttajakoodi)));
  openBrowser(ctx, start.osoite);
  ctx.gap();
  ctx.err(ctx.c.dim(t.loginWaiting));
  const deadline = ctx.now() + (start.voimassa_s ?? 600) * 1000;
  while (ctx.now() < deadline) {
    await ctx.sleep((start.valit_s ?? 2) * 1000);
    let res;
    try {
      res = await loginApi(ctx, "/api/cli/laite/tunnus", { laitekoodi: start.laitekoodi });
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) continue;
      throw e;
    }
    if (res.status === 202) continue;
    if (!TOKEN_RE.test(res.data.tunnus ?? "")) throw cliNotSupported(ctx);
    saveLogin(ctx.io.home, { tunnus: res.data.tunnus, portaali: ctx.portal, sahkoposti: res.data.kayttaja?.sahkoposti ?? "" });
    ctx.gap();
    done(ctx, t.loggedIn(res.data.kayttaja?.sahkoposti ?? ""));
    ctx.gap();
    ctx.out(t.nextInit);
    return 0;
  }
  throw new UserError(t.loginExpired);
}

async function logout(ctx) {
  const { t } = ctx;
  if (ctx.login?.env) throw new UserError(ctx.login.invalid ? t.tokenInvalid : t.tokenFromEnv);
  if (!ctx.token) {
    ctx.out(t.notLoggedInShort);
    return 0;
  }
  try {
    await ctx.api("DELETE", "/api/cli/tunnus");
  } catch (e) {
    // Vanhentunut tai jo mitätöity tunnus: poistetaan silti koneelta.
    if (!(e instanceof ApiError && e.status === 401)) warn(ctx, t.revokeFailed);
  }
  deleteLogin(ctx.io.home);
  done(ctx, t.loggedOut);
  return 0;
}

async function me(ctx) {
  requireLogin(ctx);
  return (await ctx.api("GET", "/api/cli/mina", { org: ctx.args.org })).data;
}

async function whoami(ctx) {
  const m = await me(ctx);
  if (ctx.args.json) {
    ctx.raw(JSON.stringify(m, null, 2));
    return 0;
  }
  const { o: paint } = ctx;
  ctx.out(m.kayttaja.nimi ? `${paint.bold(m.kayttaja.nimi)} ${paint.dim(`<${m.kayttaja.sahkoposti}>`)}` : paint.bold(m.kayttaja.sahkoposti));
  for (const org of m.organisaatiot) {
    const current = org.tunnus === m.organisaatio;
    ctx.out(`  ${current ? paint.green("*") : " "} ${current ? paint.bold(org.nimi) : org.nimi} ${paint.dim(`(${org.tunnus}) · ${ctx.t.roles[org.rooli] ?? org.rooli}`)}`);
  }
  return 0;
}

// ---------------------------------------------------------------------------------------------------------
// Organisaatio ja projektit

// Organisaatio: --org, kansion yhteys, tai valinta, jos käyttäjä kuuluu useampaan.
async function pickOrg(ctx) {
  if (ctx.args.org) return ctx.args.org;
  const linked = readLink(ctx.cwd);
  if (linked?.organisaatio) return linked.organisaatio;
  const m = await me(ctx);
  if (m.organisaatiot.length <= 1) return m.organisaatio;
  // Ilman päätettä (CI) ei valita hiljaa oletusorganisaatiota: projekti voisi syntyä tai julkaisu mennä väärään organisaatioon.
  if (!ctx.interactive) throw new UserError(ctx.t.needOrg(m.organisaatiot.map((o) => o.tunnus)));
  const i = await ctx.choose(
    ctx.t.pickOrg,
    m.organisaatiot.map((o) => `${o.nimi} (${o.tunnus})`),
    Math.max(0, m.organisaatiot.findIndex((o) => o.tunnus === m.organisaatio)),
  );
  return m.organisaatiot[i].tunnus;
}

async function projectList(ctx, org) {
  return (await ctx.api("GET", "/api/cli/projektit", { org })).data;
}

async function projects(ctx) {
  requireLogin(ctx);
  const org = ctx.args.org ?? readLink(ctx.cwd)?.organisaatio;
  const list = await projectList(ctx, org);
  if (ctx.args.json) {
    ctx.raw(JSON.stringify(list.projektit, null, 2));
    return 0;
  }
  if (!list.projektit.length) {
    ctx.out(ctx.t.noProjects);
    return 0;
  }
  // Leveys ennen värejä: värikoodit eivät näy, mutta lasketaan merkkijonon pituuteen.
  const { o } = ctx;
  const stateColor = { valmis: o.green, luodaan: o.yellow, virhe: o.red };
  const width = Math.max(...list.projektit.map((p) => p.nimi.length)) + 2;
  for (const p of list.projektit) {
    const state = (ctx.t.states[p.tila] ?? p.tila).padEnd(10);
    ctx.out(`  ${o.bold(p.nimi.padEnd(width))}${o.dim((ctx.t.kinds[p.tyyppi] ?? p.tyyppi).padEnd(12))}${(stateColor[p.tila] ?? String)(state)}${p.osoite ?? ""}`);
  }
  return 0;
}

// ---------------------------------------------------------------------------------------------------------
// init ja link

// Sovellus kansiosta portaalin säännöillä (sama kuin Tuo GitHubista). null = juuresta ei löytynyt.
async function detect(ctx, org) {
  const { entries, detect: files } = collect(ctx.cwd);
  const paths = entries.filter((e) => e.type === "file").map((e) => e.path);
  const { data } = await ctx.api("POST", "/api/cli/tunnista", { org, body: { tiedostot: paths.slice(0, 20_000), sisallot: files } });
  return data.sovellukset.find((a) => a.kansio === "") ?? null;
}

function saveAndTell(ctx, org, p) {
  const gitignore = saveLink(ctx.cwd, { organisaatio: org, projekti: p.nimi, vmid: p.vmid, portaali: ctx.portal });
  ctx.gap();
  done(ctx, ctx.t.linked(p.nimi));
  if (gitignore) ctx.out(ctx.o.dim(ctx.t.gitignoreAdded));
}

async function init(ctx) {
  const { t } = ctx;
  requireLogin(ctx);
  const existing = readLink(ctx.cwd);
  if (existing && !ctx.args.force) {
    ctx.out(t.alreadyLinked(ctx.o.bold(existing.projekti)));
    ctx.gap();
    ctx.out(t.nextPush);
    return 0;
  }
  const org = await pickOrg(ctx);
  const app = await detect(ctx, org);
  if (!app) throw new UserError(t.noApp);
  ctx.err(t.found(ctx.c.bold(app.tyyppi)));

  const list = await projectList(ctx, org);
  const deployable = list.projektit.filter((p) => p.julkaistava);
  if (!ctx.args.name && !ctx.args.yes && ctx.interactive && deployable.length) {
    const i = await ctx.choose(t.newOrExisting, [t.newProject, t.existingProject], 0);
    if (i === 1) return linkTo(ctx, org, deployable);
  }

  // Nimi: --name, kysymys tai kansion nimi; varattu nimi ei koskaan muutu hiljaa (portaalin sääntö).
  let name = ctx.args.name ?? (ctx.interactive && !ctx.args.yes ? await ctx.ask(t.askName, suggestName(ctx.cwd)) : suggestName(ctx.cwd));
  for (;;) {
    const { data: n } = await ctx.api("GET", "/api/cli/nimi", { org, query: { nimi: name } });
    if (n.vapaa) break;
    const why = n.syy ?? t.nameTaken(name);
    if (!ctx.interactive || ctx.args.name || ctx.args.yes) throw new UserError(`${why}${n.ehdotukset?.length ? ` ${t.suggestions(n.ehdotukset.join(", "))}` : ""}`);
    warn(ctx, `${why}${n.ehdotukset?.length ? ` ${t.suggestions(n.ehdotukset.join(", "))}` : ""}`);
    name = await ctx.ask(t.askName, n.ehdotukset?.[0] ?? "");
  }

  const uses = ["verkkosivu", "rajapinta"];
  // Portaalin ehdotus voi olla jokin muu (esim. "muu" tai puuttuva); silloin oletus on Verkkosivu, jotta pelkkä Enter kelpaa.
  let use = ctx.args.use ? normalizeUse(ctx.args.use) : uses.includes(app.kaytto) ? app.kaytto : "verkkosivu";
  if (!use) throw new UserError(t.badUse);
  if (!ctx.args.use && ctx.interactive && !ctx.args.yes) use = uses[await ctx.choose(t.askUse, [t.useSite, t.useApi], uses.indexOf(use))];

  const sizes = list.koot ?? [];
  let size = ctx.args.size ? normalizeSize(ctx.args.size) : "perus";
  if (!size) throw new UserError(t.badSize);
  if (!ctx.args.size && ctx.interactive && !ctx.args.yes && sizes.length)
    size = sizes[await ctx.choose(t.askSize, sizes.map((s) => `${s.nimi} · ${s.kuvaus} · ${s.hinta}`), Math.max(0, sizes.findIndex((s) => s.id === size)))].id;
  const chosen = sizes.find((s) => s.id === size);

  if (ctx.interactive && !ctx.args.yes) {
    ctx.gap();
    if (!(await ctx.confirm(t.confirmCreate(name, chosen ? `${chosen.nimi}, ${chosen.hinta}` : size)))) {
      ctx.out(t.cancelled);
      return 1;
    }
  }
  ctx.gap();
  ctx.err(ctx.c.dim(t.creating(name)));
  const { data: created } = await ctx.api("POST", "/api/cli/projektit", { org, body: { nimi: name, koko: size, kaytto: use }, timeoutMs: 300_000 });
  done(ctx, t.created(created.nimi, created.osoite));
  saveAndTell(ctx, org, { nimi: created.nimi, vmid: created.vmid });
  ctx.gap();
  ctx.out(t.nextPush);
  return 0;
}

const normalizeUse = (v) => ({ verkkosivu: "verkkosivu", site: "verkkosivu", web: "verkkosivu", rajapinta: "rajapinta", api: "rajapinta" })[String(v).toLowerCase()] ?? null;
const normalizeSize = (v) => ({ pieni: "pieni", small: "pieni", perus: "perus", basic: "perus", iso: "iso", large: "iso" })[String(v).toLowerCase()] ?? null;

async function linkTo(ctx, org, deployable) {
  const { t } = ctx;
  let p;
  if (ctx.args.project) {
    p = deployable.find((x) => x.nimi === ctx.args.project);
    if (!p) throw new UserError(t.projectNotDeployable(ctx.args.project));
  } else {
    if (!deployable.length) throw new UserError(t.noDeployable);
    if (!ctx.interactive) throw new UserError(t.needProject);
    p = deployable[await ctx.choose(t.pickProject, deployable.map((x) => `${x.nimi}${x.osoite ? ` · ${x.osoite}` : ""}`), 0)];
  }
  saveAndTell(ctx, org, p);
  ctx.gap();
  ctx.out(t.nextPush);
  return 0;
}

async function link(ctx) {
  requireLogin(ctx);
  const org = await pickOrg(ctx);
  const list = await projectList(ctx, org);
  return linkTo(ctx, org, list.projektit.filter((p) => p.julkaistava));
}

// ---------------------------------------------------------------------------------------------------------
// push

// Kohde: --project (organisaation listalta) tai kansion yhteys; ilman niitä päätteessä init.
// noInit: komento (promote) ei aloita initiä yhdistämättömässä kansiossa.
async function target(ctx, { noInit = false } = {}) {
  if (ctx.args.project) {
    const org = await pickOrg(ctx);
    const p = (await projectList(ctx, org)).projektit.find((x) => x.nimi === ctx.args.project);
    if (!p) throw new UserError(ctx.t.projectNotFound(ctx.args.project));
    return { org, projekti: p.nimi, vmid: p.vmid };
  }
  const linked = readLink(ctx.cwd);
  // Toisen portaalin (esim. testiympäristön) projektinumero osoittaisi tässä portaalissa eri projektiin.
  if (linked?.portaali && linked.portaali !== ctx.portal) throw new UserError(ctx.t.linkOtherPortal(linked.portaali, ctx.portal));
  if (linked) return { org: linked.organisaatio, projekti: linked.projekti, vmid: linked.vmid };
  if (!ctx.interactive || noInit) throw new UserError(ctx.t.notLinked);
  ctx.err(ctx.t.notLinkedInit);
  // init kertoo itse perumisen ("Peruttu."), joten tässä ei toista viestiä: null = push päättyy paluukoodiin 1.
  if ((await init(ctx)) !== 0) return null;
  const now = readLink(ctx.cwd);
  return { org: now.organisaatio, projekti: now.projekti, vmid: now.vmid };
}

const STAGES = ["jonossa", "haetaan", "rakennetaan", "siirretaan", "kaynnistetaan"];

// Kesto lyhyesti: 42 s, 3 min 05 s.
function duration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
}

// Edistymispalkki: täytetty osa syaanilla, loput himmeänä.
function progressBar(c, ratio, width = 24) {
  const full = Math.round(Math.min(1, Math.max(0, ratio)) * width);
  return `${c.cyan("━".repeat(full))}${c.dim("─".repeat(width - full))}`;
}
const FOLLOW_MAX_MS = 45 * 60_000;
const CONNECTION_LOST_MS = 5 * 60_000;

async function push(ctx) {
  const { t } = ctx;
  requireLogin(ctx);
  const prod = Boolean(ctx.args.prod);
  const dest = await target(ctx);
  if (!dest) return 1;

  const { entries, skipped, unreadable } = collect(ctx.cwd);
  if (unreadable.length) throw new UserError(t.unreadable(unreadable.slice(0, 5).map((u) => `${u.path} (${u.code})`), unreadable.length));
  const files = entries.filter((e) => e.type === "file");
  if (!files.length) throw new UserError(t.emptyFolder);
  for (const s of skipped) warn(ctx, s.reason === "size" ? t.skippedBig(s.path, sizeText(s.size, ctx.lang)) : t.skippedLink(s.path));
  let pkg;
  try {
    pkg = await packEntries(entries);
  } catch (e) {
    if (e.code === "too_big") throw new UserError(t.tooBig(sizeText(UPLOAD_MAX_BYTES, ctx.lang)));
    if (e.code === "unreadable") throw new UserError(t.unreadable([`${e.path} (${e.reason})`], 1));
    throw e;
  }
  ctx.err(t.uploading(files.length, sizeText(pkg.length, ctx.lang), ctx.c.bold(dest.projekti)));
  // Päätteessä palkki: lähetetty osuus ja määrä; kun kaikki on lähetetty, Boggo Cloud vielä tarkistaa paketin ennen vastausta.
  let sent = 0;
  const total = pkg.length;
  const progress = ctx.startLive(
    () =>
      sent < total
        ? `${progressBar(ctx.c, sent / total)} ${Math.floor((sent / total) * 100)} % · ${sizeText(sent, ctx.lang)} / ${sizeText(total, ctx.lang)}`
        : `${progressBar(ctx.c, 1)} 100 % · ${ctx.c.dim(t.uploadChecking)}`,
    { indent: "  " },
  );

  // Uusi projekti voi olla vielä luonnissa: odotetaan enintään 5 min.
  let started;
  const until = ctx.now() + 5 * 60_000;
  const deploymentsUrl = `${ctx.portal}/${dest.projekti}/julkaisut`;
  for (;;) {
    try {
      started = (
        await ctx.api("POST", `/api/cli/projektit/${dest.vmid}/julkaisut`, {
          org: dest.org,
          body: pkg,
          query: { tuotanto: prod ? 1 : undefined },
          timeoutMs: uploadTimeoutMs(pkg.length),
          onProgress: progress ? (n) => (sent = n) : undefined,
        })
      ).data;
      break;
    } catch (e) {
      // Aikaraja: paketti voi olla jo perillä ja julkaisu alkanut, joten ei lähetetä uudelleen vaan ohjataan tarkistamaan.
      if (e instanceof ApiError && e.status === 0 && e.data?.timeout) throw new UserError(t.uploadTimedOut(deploymentsUrl));
      // Projekti luonnissa: portaalin koodi syy = luonti_kesken (vanhempi portaali: tunnistus tekstistä).
      if (e instanceof ApiError && e.status === 409 && (e.data?.syy === "luonti_kesken" || (!e.data?.syy && /valmis|ready/i.test(e.message))) && ctx.now() < until) {
        ctx.err(ctx.c.dim(t.waitingCreate));
        await ctx.sleep(10_000);
        continue;
      }
      throw e;
    }
  }
  ctx.stopLive();
  const label = prod ? t.deployment(started.numero) : t.build(started.numero);
  ctx.err(t.queued(ctx.c.bold(label), started.sovellus));
  ctx.gap();
  return follow(ctx, dest, started.numero, prod, started.osoite);
}

// Seuraa julkaisua tai rakennusta numerolla, kunnes se päättyy (push ja promote). Paluukoodi 0 = onnistui.
async function follow(ctx, dest, numero, prod, address) {
  const { t } = ctx;
  const deploymentsUrl = `${ctx.portal}/${dest.projekti}/julkaisut`;

  // Seuranta: uusi vaihe kerran, aika vaiheen alusta. Seuranta päättyy aina: julkaisu kestää yli FOLLOW_MAX_MS tai
  // Boggo Cloudiin ei saada yhteyttä CONNECTION_LOST_MS:ään. Kummassakin paluukoodi on 1, koska julkaisun tulos ei ole
  // tiedossa (CI ei saa tulkita sitä onnistumiseksi).
  const shown = new Set();
  const began = ctx.now();
  const followUrl = deploymentsUrl;
  let lastOk = began;
  let d;
  // Päätteessä käynnissä oleva vaihe elävänä rivinä (kesto kasvaa) ja valmis vaihe ✓-rivinä kestoineen; muualla vaihe kerran.
  let current = null;
  const stageName = (vaihe) => t.stages[vaihe] ?? vaihe;
  const live = ctx.startLive(() => `${stageName(current?.vaihe ?? "jonossa")}… ${ctx.c.dim(duration(ctx.now() - (current?.seen ?? began)))}`, { indent: "  " });
  // Päättynyt vaihe ✓- tai ✗-rivinä. Kutsuja vaihtaa elävän rivin vaiheen ensin, jotta rivin alle ei piirry vanha vaihe.
  const finishStage = (stage, ok) => {
    if (!stage) return;
    // Kesto portaalin aikaleimoista, jos vaihe on niissä päättynyt; muuten siitä, kun vaihe nähtiin.
    const step = (d?.steps ?? []).find((s) => s.vaihe === stage.vaihe);
    const server = step?.paattyi ? Date.parse(step.paattyi) - Date.parse(step.alkoi) : NaN;
    const ms = Number.isFinite(server) && server >= 0 ? server : ctx.now() - stage.seen;
    ctx.err(`  ${ok ? ctx.c.green("✓") : ctx.c.red("✗")} ${stageName(stage.vaihe)} ${ctx.c.dim(duration(ms))}`);
  };
  for (;;) {
    await ctx.sleep(2000);
    if (ctx.now() - began > FOLLOW_MAX_MS) {
      ctx.stopLive();
      ctx.gap();
      warn(ctx, t.stillRunning(followUrl));
      return 1;
    }
    try {
      d = (await ctx.api("GET", `/api/cli/projektit/${dest.vmid}/julkaisut/${numero}`, { org: dest.org })).data;
      lastOk = ctx.now();
    } catch (e) {
      if (!(e instanceof ApiError && (e.status === 0 || e.status >= 500))) throw e;
      if (ctx.now() - lastOk > CONNECTION_LOST_MS) {
        ctx.stopLive();
        ctx.gap();
        warn(ctx, t.lostTrack(followUrl));
        return 1;
      }
      continue;
    }
    for (const s of d.steps ?? []) {
      if (shown.has(s.vaihe) || !STAGES.includes(s.vaihe)) continue;
      shown.add(s.vaihe);
      if (!live) {
        ctx.err(`  ${ctx.c.cyan("›")} ${stageName(s.vaihe)}…`);
        continue;
      }
      const previous = current;
      current = { vaihe: s.vaihe, seen: ctx.now() };
      finishStage(previous, true);
    }
    const status = d.deployment.status;
    if (status === "valmis" || status === "epaonnistui" || status === "korvattu") break;
  }
  ctx.stopLive();
  if (live) finishStage(current, d.deployment.status === "valmis");
  const secs = Math.round((ctx.now() - began) / 1000);
  ctx.gap();
  if (d.deployment.status === "valmis") {
    if (prod) {
      done(ctx, t.deployed(secs));
      if (address) ctx.out(`  ${ctx.o.underline(address)}`);
    } else {
      done(ctx, t.built(secs));
      ctx.gap();
      // Portaali kertoo, voiko rakennuksen julkaista sellaisenaan (rakentajan sopimus luku 9); muuten uusi rakennus --prodilla.
      if (d.deployment.promote) {
        rememberBuild(ctx, dest, numero);
        ctx.out(t.nextPromote);
      } else ctx.out(t.nextProd);
    }
    return 0;
  }
  if (d.deployment.status === "korvattu") {
    warn(ctx, t.replaced);
    return 1;
  }
  ctx.err(`${ctx.c.red(ctx.c.bold(t.errorMark))} ${d.deployment.error ?? t.failed}`);
  // Rakennuksen loki kehittäjälle (portaali antaa sen vain kehittäjän roolilla): viimeiset rivit.
  const lines = (d.log ?? []).filter((l) => l.taso !== "info" || l.vaihe === "rakennetaan" || l.lahde === "sovellus").slice(-25);
  if (lines.length) {
    ctx.gap();
    for (const l of lines) ctx.err(`  ${l.taso === "virhe" ? ctx.c.red(l.teksti) : ctx.c.dim(l.teksti)}`);
  }
  ctx.gap();
  ctx.err(t.seeLog(`${ctx.portal}/${dest.projekti}/julkaisut`));
  return 1;
}

// ---------------------------------------------------------------------------------------------------------
// promote

// Viimeisin julkaistavissa oleva rakennus kansion yhteyteen (.boggo/projekti.json), jotta boggo promote löytää sen ilman numeroa.
function rememberBuild(ctx, dest, numero) {
  const linked = readLink(ctx.cwd);
  if (!linked || linked.vmid !== dest.vmid) return;
  try {
    saveLink(ctx.cwd, { ...linked, rakennus: numero });
  } catch {
    /* ei estä mitään: boggo promote <numero> toimii silti */
  }
}

// boggo promote [numero]: julkaisee onnistuneen rakennuksen (boggo push) tuotantoon ilman uutta rakennusta. Ilman numeroa kansion
// viimeisin rakennus. Julkiset muuttujat (NEXT_PUBLIC_, VITE_) ovat rakennuksessa: jos ne ovat muuttuneet, kysytään (tai --force).
async function promote(ctx) {
  const { t } = ctx;
  requireLogin(ctx);
  const given = ctx.args.positionals?.[0];
  if (given !== undefined && !/^[1-9]\d{0,8}$/.test(given)) throw new UserError(t.badBuildNumber(given));
  const dest = await target(ctx, { noInit: true });
  if (!dest) return 1;
  const linked = readLink(ctx.cwd);
  const numero = given !== undefined ? Number(given) : linked?.vmid === dest.vmid ? linked.rakennus : undefined;
  if (!Number.isSafeInteger(numero) || numero <= 0) throw new UserError(t.noBuild);
  let started;
  let force = Boolean(ctx.args.force);
  for (;;) {
    try {
      started = (
        await ctx.api("POST", `/api/cli/projektit/${dest.vmid}/julkaisut/${numero}`, { org: dest.org, body: force ? { pakota: true } : {} })
      ).data;
      break;
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 409 && e.data?.muuttujat === "muuttuneet") || force) throw e;
      warn(ctx, e.message);
      if (!ctx.interactive) throw new UserError(t.varsChangedForce);
      if (!(await ctx.confirm(t.promoteAnyway))) {
        ctx.out(t.cancelled);
        return 1;
      }
      force = true;
    }
  }
  ctx.err(t.promoting(ctx.c.bold(t.build(numero)), ctx.c.bold(t.deployment(started.numero))));
  ctx.gap();
  return follow(ctx, dest, started.numero, true, started.osoite);
}

// ---------------------------------------------------------------------------------------------------------
// open

async function open(ctx) {
  const linked = readLink(ctx.cwd);
  const name = ctx.args.project ?? linked?.projekti;
  if (!name) throw new UserError(ctx.t.notLinked);
  let url;
  if (ctx.args.portal) url = `${linked?.portaali ?? ctx.portal}/${name}`;
  else {
    requireLogin(ctx);
    const p = (await projectList(ctx, ctx.args.org ?? linked?.organisaatio)).projektit.find((x) => x.nimi === name);
    if (!p) throw new UserError(ctx.t.projectNotFound(name));
    if (!p.osoite) throw new UserError(ctx.t.noAddress(name));
    url = p.osoite;
  }
  ctx.out(url);
  openBrowser(ctx, url);
  return 0;
}
