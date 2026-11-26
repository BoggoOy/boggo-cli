// Komennot, jotka puhuvat Boggo Cloudin kanssa: login, logout, whoami, projects, init, link, push ja open.
// Kulku uudelle projektille: boggo login → boggo init (uusi projekti tai olemassa oleva) → boggo push --prod.
// Tekstit: src/command-texts.js (suomi ja englanti).
import { spawn } from "node:child_process";
import { ApiError, call, deleteLogin, deviceName, portalUrl, readLogin, saveLogin } from "./api.js";
import { CMD } from "./command-texts.js";
import { lineReader } from "./lang.js";
import { readLink, saveLink, suggestName } from "./link.js";
import { collect, packEntries, sizeText, UPLOAD_MAX_BYTES } from "./pack.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Yhteinen tila: tekstit, tulosteet, kysymykset ja portaali.
export function context(io, lang, args, version) {
  const t = CMD[lang];
  const login = readLogin(io.home, io.env);
  const interactive = Boolean(io.stdin.isTTY && io.stderr.isTTY) && !(io.env.CI && io.env.CI !== "false" && io.env.CI !== "0");
  let lines = null;
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
    out: (s = "") => io.stdout.write(`${s}\n`),
    err: (s = "") => io.stderr.write(`${s}\n`),
    async ask(question, fallback = "") {
      lines ??= lineReader(io.stdin);
      io.stderr.write(`${question}${fallback ? ` (${fallback})` : ""}: `);
      const line = await lines.next();
      if (line === null) throw new UserError(t.inputEnded);
      return line.trim() || fallback;
    },
    // Valinta numerolla; Enter = oletus.
    async choose(question, options, def = 0) {
      io.stderr.write(`${question}\n`);
      options.forEach((o, i) => io.stderr.write(`  ${i + 1}) ${o}${i === def ? ` ${t.defaultMark}` : ""}\n`));
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
export class UserError extends Error {}

export async function runCommand(ctx, command, rest) {
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
      case "deploy":
        ctx.args.prod = true;
        return await push(ctx);
      case "open":
        return await open(ctx);
      default:
        void rest;
        throw new UserError(ctx.t.unknown(command));
    }
  } catch (e) {
    if (e instanceof UserError || e instanceof ApiError) {
      ctx.err(`${ctx.t.errorMark} ${e.message}`);
      return 1;
    }
    throw e;
  } finally {
    ctx.close();
  }
}

function requireLogin(ctx) {
  if (ctx.login?.invalid) throw new UserError(ctx.t.tokenInvalid);
  if (!ctx.token) throw new UserError(ctx.t.notLoggedIn);
}

// ---------------------------------------------------------------------------------------------------------
// login, logout, whoami

function openBrowser(ctx, url) {
  if (ctx.io.env.BOGGO_NO_BROWSER || !ctx.interactive) return false;
  const [cmd, args] =
    process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

async function login(ctx) {
  const { t } = ctx;
  if (ctx.login?.env) throw new UserError(ctx.login.invalid ? t.tokenInvalid : t.tokenFromEnv);
  ctx.token = null;
  const { data: start } = await ctx.api("POST", "/api/cli/laite", { body: { nimi: deviceName() } });
  ctx.err(t.loginOpen);
  ctx.err(`  ${start.osoite}`);
  ctx.err(t.loginCode(start.kayttajakoodi));
  openBrowser(ctx, start.osoite);
  ctx.err(t.loginWaiting);
  const deadline = ctx.now() + (start.voimassa_s ?? 600) * 1000;
  while (ctx.now() < deadline) {
    await ctx.sleep((start.valit_s ?? 2) * 1000);
    let res;
    try {
      res = await ctx.api("POST", "/api/cli/laite/tunnus", { body: { laitekoodi: start.laitekoodi } });
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) continue;
      throw e;
    }
    if (res.status === 202) continue;
    saveLogin(ctx.io.home, { tunnus: res.data.tunnus, portaali: ctx.portal, sahkoposti: res.data.kayttaja?.sahkoposti ?? "" });
    ctx.out(t.loggedIn(res.data.kayttaja?.sahkoposti ?? ""));
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
    if (!(e instanceof ApiError && e.status === 401)) ctx.err(`${t.warnMark} ${t.revokeFailed}`);
  }
  deleteLogin(ctx.io.home);
  ctx.out(t.loggedOut);
  return 0;
}

async function me(ctx) {
  requireLogin(ctx);
  return (await ctx.api("GET", "/api/cli/mina", { org: ctx.args.org })).data;
}

async function whoami(ctx) {
  const m = await me(ctx);
  if (ctx.args.json) {
    ctx.out(JSON.stringify(m, null, 2));
    return 0;
  }
  ctx.out(`${m.kayttaja.nimi ? `${m.kayttaja.nimi} <${m.kayttaja.sahkoposti}>` : m.kayttaja.sahkoposti}`);
  for (const o of m.organisaatiot) ctx.out(`  ${o.tunnus === m.organisaatio ? "*" : " "} ${o.nimi} (${o.tunnus}) · ${ctx.t.roles[o.rooli] ?? o.rooli}`);
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
  if (m.organisaatiot.length <= 1 || !ctx.interactive) return m.organisaatio;
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
    ctx.out(JSON.stringify(list.projektit, null, 2));
    return 0;
  }
  if (!list.projektit.length) {
    ctx.out(ctx.t.noProjects);
    return 0;
  }
  const width = Math.max(...list.projektit.map((p) => p.nimi.length)) + 2;
  for (const p of list.projektit)
    ctx.out(`  ${p.nimi.padEnd(width)}${(ctx.t.kinds[p.tyyppi] ?? p.tyyppi).padEnd(12)}${(ctx.t.states[p.tila] ?? p.tila).padEnd(10)}${p.osoite ?? ""}`);
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
  ctx.out(ctx.t.linked(p.nimi));
  if (gitignore) ctx.out(ctx.t.gitignoreAdded);
}

async function init(ctx) {
  const { t } = ctx;
  requireLogin(ctx);
  const existing = readLink(ctx.cwd);
  if (existing && !ctx.args.force) {
    ctx.out(t.alreadyLinked(existing.projekti));
    ctx.out(t.nextPush);
    return 0;
  }
  const org = await pickOrg(ctx);
  const app = await detect(ctx, org);
  if (!app) throw new UserError(t.noApp);
  ctx.err(t.found(app.tyyppi));

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
    ctx.err(`${t.warnMark} ${why}${n.ehdotukset?.length ? ` ${t.suggestions(n.ehdotukset.join(", "))}` : ""}`);
    name = await ctx.ask(t.askName, n.ehdotukset?.[0] ?? "");
  }

  const uses = ["verkkosivu", "rajapinta"];
  let use = ctx.args.use ? normalizeUse(ctx.args.use) : app.kaytto ?? "verkkosivu";
  if (!use) throw new UserError(t.badUse);
  if (!ctx.args.use && ctx.interactive && !ctx.args.yes) use = uses[await ctx.choose(t.askUse, [t.useSite, t.useApi], uses.indexOf(use))];

  const sizes = list.koot ?? [];
  let size = ctx.args.size ? normalizeSize(ctx.args.size) : "perus";
  if (!size) throw new UserError(t.badSize);
  if (!ctx.args.size && ctx.interactive && !ctx.args.yes && sizes.length)
    size = sizes[await ctx.choose(t.askSize, sizes.map((s) => `${s.nimi} · ${s.kuvaus} · ${s.hinta}`), Math.max(0, sizes.findIndex((s) => s.id === size)))].id;
  const chosen = sizes.find((s) => s.id === size);

  if (ctx.interactive && !ctx.args.yes && !(await ctx.confirm(t.confirmCreate(name, chosen ? `${chosen.nimi}, ${chosen.hinta}` : size)))) {
    ctx.out(t.cancelled);
    return 1;
  }
  ctx.err(t.creating(name));
  const { data: created } = await ctx.api("POST", "/api/cli/projektit", { org, body: { nimi: name, koko: size, kaytto: use }, timeoutMs: 300_000 });
  ctx.out(t.created(created.nimi, created.osoite));
  saveAndTell(ctx, org, { nimi: created.nimi, vmid: created.vmid });
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
async function target(ctx) {
  if (ctx.args.project) {
    const org = await pickOrg(ctx);
    const p = (await projectList(ctx, org)).projektit.find((x) => x.nimi === ctx.args.project);
    if (!p) throw new UserError(ctx.t.projectNotFound(ctx.args.project));
    return { org, projekti: p.nimi, vmid: p.vmid };
  }
  const linked = readLink(ctx.cwd);
  if (linked) return { org: linked.organisaatio, projekti: linked.projekti, vmid: linked.vmid };
  if (!ctx.interactive) throw new UserError(ctx.t.notLinked);
  ctx.err(ctx.t.notLinkedInit);
  if ((await init(ctx)) !== 0) throw new UserError(ctx.t.cancelled);
  const now = readLink(ctx.cwd);
  return { org: now.organisaatio, projekti: now.projekti, vmid: now.vmid };
}

const STAGES = ["jonossa", "haetaan", "rakennetaan", "siirretaan", "kaynnistetaan"];
const FOLLOW_MAX_MS = 45 * 60_000;
const CONNECTION_LOST_MS = 5 * 60_000;

async function push(ctx) {
  const { t } = ctx;
  requireLogin(ctx);
  const prod = Boolean(ctx.args.prod);
  const dest = await target(ctx);

  const { entries, skipped, unreadable } = collect(ctx.cwd);
  if (unreadable.length) throw new UserError(t.unreadable(unreadable.slice(0, 5).map((u) => `${u.path} (${u.code})`), unreadable.length));
  const files = entries.filter((e) => e.type === "file");
  if (!files.length) throw new UserError(t.emptyFolder);
  for (const s of skipped) ctx.err(`${t.warnMark} ${s.reason === "size" ? t.skippedBig(s.path, sizeText(s.size, ctx.lang)) : t.skippedLink(s.path)}`);
  let pkg;
  try {
    pkg = await packEntries(entries);
  } catch (e) {
    if (e.code === "too_big") throw new UserError(t.tooBig(sizeText(UPLOAD_MAX_BYTES, ctx.lang)));
    if (e.code === "unreadable") throw new UserError(t.unreadable([`${e.path} (${e.reason})`], 1));
    throw e;
  }
  ctx.err(t.uploading(files.length, sizeText(pkg.length, ctx.lang), dest.projekti));

  // Uusi projekti voi olla vielä luonnissa: odotetaan enintään 5 min.
  let started;
  const until = ctx.now() + 5 * 60_000;
  for (;;) {
    try {
      started = (await ctx.api("POST", `/api/cli/projektit/${dest.vmid}/julkaisut`, { org: dest.org, body: pkg, query: { tuotanto: prod ? 1 : undefined }, timeoutMs: 300_000 })).data;
      break;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && /valmis|ready/i.test(e.message) && ctx.now() < until) {
        ctx.err(t.waitingCreate);
        await ctx.sleep(10_000);
        continue;
      }
      throw e;
    }
  }
  const label = prod ? t.deployment(started.numero) : t.build(started.numero);
  ctx.err(t.queued(label, started.sovellus));

  // Seuranta: uusi vaihe kerran, aika vaiheen alusta. Seuranta päättyy aina: julkaisu kestää yli FOLLOW_MAX_MS tai
  // Boggo Cloudiin ei saada yhteyttä CONNECTION_LOST_MS:ään. Kummassakin paluukoodi on 1, koska julkaisun tulos ei ole
  // tiedossa (CI ei saa tulkita sitä onnistumiseksi).
  const shown = new Set();
  const began = ctx.now();
  const followUrl = `${ctx.portal}/${dest.projekti}/julkaisut`;
  let lastOk = began;
  let d;
  for (;;) {
    await ctx.sleep(2000);
    if (ctx.now() - began > FOLLOW_MAX_MS) {
      ctx.err(`${t.warnMark} ${t.stillRunning(followUrl)}`);
      return 1;
    }
    try {
      d = (await ctx.api("GET", `/api/cli/projektit/${dest.vmid}/julkaisut/${started.numero}`, { org: dest.org })).data;
      lastOk = ctx.now();
    } catch (e) {
      if (!(e instanceof ApiError && (e.status === 0 || e.status >= 500))) throw e;
      if (ctx.now() - lastOk > CONNECTION_LOST_MS) {
        ctx.err(`${t.warnMark} ${t.lostTrack(followUrl)}`);
        return 1;
      }
      continue;
    }
    for (const s of d.steps ?? []) {
      if (shown.has(s.vaihe) || !STAGES.includes(s.vaihe)) continue;
      shown.add(s.vaihe);
      ctx.err(`  ${t.stages[s.vaihe] ?? s.vaihe}…`);
    }
    const status = d.deployment.status;
    if (status === "valmis" || status === "epaonnistui" || status === "korvattu") break;
  }
  const secs = Math.round((ctx.now() - began) / 1000);
  if (d.deployment.status === "valmis") {
    if (prod) {
      ctx.out(t.deployed(secs));
      ctx.out(`  ${started.osoite}`);
    } else {
      ctx.out(t.built(secs));
      ctx.out(t.nextProd);
    }
    return 0;
  }
  if (d.deployment.status === "korvattu") {
    ctx.out(t.replaced);
    return 1;
  }
  ctx.err(`${t.errorMark} ${d.deployment.error ?? t.failed}`);
  // Rakennuksen loki kehittäjälle (portaali antaa sen vain kehittäjän roolilla): viimeiset rivit.
  const lines = (d.log ?? []).filter((l) => l.taso !== "info" || l.vaihe === "rakennetaan" || l.lahde === "sovellus").slice(-25);
  if (lines.length) {
    ctx.err("");
    for (const l of lines) ctx.err(`  ${l.teksti}`);
  }
  ctx.err("");
  ctx.err(t.seeLog(`${ctx.portal}/${dest.projekti}/julkaisut`));
  return 1;
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
