// Komennot valeportaalia vasten (ei verkkoa): login → init → push --prod, push ilman --prod, virheet ja paketointi.
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";
import { main } from "../src/cli.js";
import { uploadTimeoutMs } from "../src/api.js";
import { browserCommand } from "../src/commands.js";
import { collect, ignored, packEntries, parseIgnore } from "../src/pack.js";

const TOKEN = `boggo_${"t".repeat(43)}`;

function sink() {
  let text = "";
  return { isTTY: false, write: (s) => ((text += s), true), get text() { return text; } };
}

// Valeportaali: vastaa CLI:n reitteihin ja kirjaa pyynnöt.
// follow(reads): oma vastaus julkaisun tilan kyselyyn (Response tai heitetty virhe = verkko poikki).
// kaytto: tunnistuksen ehdottama käyttö (oletus verkkosivu), orgs: organisaatiot, upload(n): oma vastaus paketin lähetykseen
// (Response, heitetty virhe tai undefined = tavallinen), projects: valmiit projektit.
function fakePortal({ fail, follow, kaytto = "verkkosivu", orgs, upload, projects: initial = [] } = {}) {
  const calls = [];
  let polls = 0;
  let reads = 0;
  let uploads = 0;
  const projects = [...initial];
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const auth = init.headers?.Authorization;
    calls.push({ method: init.method, path: u.pathname, search: u.search, auth, org: init.headers?.["X-Boggo-Organisaatio"], body: init.body });
    const p = u.pathname;
    if (p === "/api/cli/laite")
      return json(201, { laitekoodi: "l".repeat(43), kayttajakoodi: "KHTR-4MXA", osoite: "https://portaali.test/cli?koodi=KHTR-4MXA", voimassa_s: 600, valit_s: 2 });
    if (p === "/api/cli/laite/tunnus") return ++polls < 2 ? json(202, { tila: "odottaa" }) : json(200, { tunnus: TOKEN, kayttaja: { sahkoposti: "don@example.com" } });
    if (auth !== `Bearer ${TOKEN}`) return json(401, { error: "Kirjaudu ensin: boggo login", login: true });
    if (p === "/api/cli/mina")
      return json(200, { kayttaja: { sahkoposti: "don@example.com", nimi: "Don" }, organisaatio: "boggo", organisaatiot: orgs ?? [{ tunnus: "boggo", nimi: "Boggo Oy", rooli: "owner" }] });
    if (p === "/api/cli/tunnus") return new Response(null, { status: 204 });
    if (p === "/api/cli/tunnista") {
      const b = JSON.parse(init.body);
      return json(200, { sovellukset: b.tiedostot.includes("package.json") ? [{ kansio: "", tyyppi: "NextJS", kaytto, portti: 3000 }] : [] });
    }
    if (p === "/api/cli/nimi") return json(200, u.searchParams.get("nimi") === "varattu" ? { vapaa: false, syy: "Nimi varattu on jo käytössä.", ehdotukset: ["varattu-2"] } : { vapaa: true });
    if (p === "/api/cli/projektit" && init.method === "GET")
      return json(200, { projektit: projects, koot: [{ id: "perus", nimi: "Perus", kuvaus: "1 vCPU", hinta: "9 €/kk + alv" }] });
    if (p === "/api/cli/projektit" && init.method === "POST") {
      const b = JSON.parse(init.body);
      projects.push({ nimi: b.nimi, vmid: 1234, tyyppi: "palvelin", tila: "valmis", osoite: `https://${b.nimi}.boggo.app`, julkaistava: true });
      return json(201, { vmid: 1234, nimi: b.nimi, osoite: `https://${b.nimi}.boggo.app` });
    }
    if (p === "/api/cli/projektit/1234/julkaisut" && upload) {
      const r = await upload(++uploads, json);
      if (r) return r;
    }
    if (p === "/api/cli/projektit/1234/julkaisut") return json(201, { numero: 7, tavut: init.body.length, tiedostot: 2, sovellus: "NextJS", osoite: "https://kauppa.boggo.app" });
    if (p === "/api/cli/projektit/1234/julkaisut/7") {
      reads++;
      if (follow) return follow(reads);
      const steps = ["haetaan", "rakennetaan", "siirretaan", "kaynnistetaan"].slice(0, reads).map((vaihe) => ({ vaihe, alkoi: "2026-11-25T12:00:00Z" }));
      const done = reads >= 4;
      if (fail && done)
        return json(200, { deployment: { status: "epaonnistui", error: "Rakennus epäonnistui. Katso rakennusloki." }, steps, log: [{ vaihe: "rakennetaan", taso: "virhe", teksti: "npm ERR! missing script: build" }] });
      return json(200, { deployment: { status: done ? "valmis" : "rakennetaan" }, steps, log: [] });
    }
    return json(404, { error: "ei löydy" });
  };
  return { fetch, calls };
}

async function run(argv, { home, cwd, portal, env = {}, clock }) {
  const stdout = sink();
  const stderr = sink();
  const stdin = new PassThrough();
  stdin.isTTY = false;
  stdin.end();
  const code = await main({
    argv,
    env: { BOGGO_LANG: "fi", BOGGO_URL: "https://portaali.test", BOGGO_NO_BROWSER: "1", ...env },
    stdout,
    stderr,
    stdin,
    home,
    cwd,
    fetch: portal.fetch,
    sleep: clock?.sleep ?? (async () => {}),
    now: clock?.now,
  });
  return { code, out: stdout.text, err: stderr.text };
}

function project() {
  const dir = mkdtempSync(join(tmpdir(), "boggo-projekti-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ dependencies: { next: "16.0.0" } }));
  mkdirSync(join(dir, "app"));
  writeFileSync(join(dir, "app", "page.tsx"), "export default function P() { return null }\n");
  writeFileSync(join(dir, ".env"), "SALAINEN=1\n");
  mkdirSync(join(dir, "node_modules", "x"), { recursive: true });
  writeFileSync(join(dir, "node_modules", "x", "i.js"), "x");
  mkdirSync(join(dir, ".git"));
  writeFileSync(join(dir, ".git", "HEAD"), "ref: refs/heads/main\n");
  return dir;
}

test("login → init → push --prod: tunnus talteen 600, kansio yhdistetään, julkaisu seurataan loppuun", async () => {
  const portal = fakePortal();
  const home = mkdtempSync(join(tmpdir(), "boggo-koti-"));
  const cwd = project();

  const login = await run(["login"], { home, cwd, portal });
  assert.equal(login.code, 0, login.err);
  assert.match(login.err, /KHTR-4MXA/);
  assert.match(login.out, /Kirjauduttu: don@example.com/);
  const saved = join(home, ".boggo", "tunnus.json");
  assert.equal(statSync(saved).mode & 0o777, 0o600);
  assert.equal(JSON.parse(readFileSync(saved, "utf8")).tunnus, TOKEN);
  assert.ok(!login.out.includes(TOKEN) && !login.err.includes(TOKEN), "tunnusta ei tulosteta");

  const init = await run(["init", "--name", "kauppa", "--yes"], { home, cwd, portal });
  assert.equal(init.code, 0, init.err);
  assert.match(init.out, /Projekti kauppa luotu: https:\/\/kauppa.boggo.app/);
  assert.deepEqual(JSON.parse(readFileSync(join(cwd, ".boggo", "projekti.json"), "utf8")), { organisaatio: "boggo", projekti: "kauppa", vmid: 1234, portaali: "https://portaali.test" });
  assert.match(readFileSync(join(cwd, ".gitignore"), "utf8"), /^\.boggo$/m);
  const created = portal.calls.find((c) => c.path === "/api/cli/projektit" && c.method === "POST");
  assert.deepEqual(JSON.parse(created.body), { nimi: "kauppa", koko: "perus", kaytto: "verkkosivu" });
  // Tunnistukseen ei lähde .env eikä node_modules.
  const detect = JSON.parse(portal.calls.find((c) => c.path === "/api/cli/tunnista").body);
  assert.deepEqual(detect.tiedostot, ["app/page.tsx", "package.json"]);

  const push = await run(["push", "--prod"], { home, cwd, portal });
  assert.equal(push.code, 0, push.err);
  assert.match(push.err, /Julkaisu #7 aloitettu \(NextJS\)/);
  assert.match(push.err, /Rakennetaan…/);
  assert.match(push.out, /Julkaistu/);
  assert.match(push.out, /https:\/\/kauppa.boggo.app/);
  const upload = portal.calls.find((c) => c.path === "/api/cli/projektit/1234/julkaisut");
  assert.equal(upload.search, "?tuotanto=1");
  assert.equal(upload.org, "boggo");
  const tar = gunzipSync(upload.body).toString("latin1");
  assert.ok(tar.includes("package.json") && tar.includes("app/page.tsx"));
  assert.ok(!tar.includes("SALAINEN") && !tar.includes("node_modules") && !tar.includes(".git/HEAD"), "ei salaisuuksia eikä riippuvuuksia");
});

test("push ilman --prod: pelkkä rakennus, epäonnistuminen näyttää syyn ja lokin", async () => {
  const portal = fakePortal({ fail: true });
  const home = mkdtempSync(join(tmpdir(), "boggo-koti-"));
  const cwd = project();
  await run(["login"], { home, cwd, portal });
  await run(["init", "--name", "kauppa", "--yes"], { home, cwd, portal });
  const r = await run(["push"], { home, cwd, portal });
  assert.equal(r.code, 1);
  assert.equal(portal.calls.find((c) => c.path === "/api/cli/projektit/1234/julkaisut").search, "");
  assert.match(r.err, /Rakennus #7 aloitettu/);
  assert.match(r.err, /Virhe: Rakennus epäonnistui/);
  assert.match(r.err, /missing script: build/);
  assert.match(r.err, /https:\/\/portaali.test\/kauppa\/julkaisut/);
});

test("ilman kirjautumista, varattu nimi ja yhdistämätön kansio ilman päätettä", async () => {
  const portal = fakePortal();
  const home = mkdtempSync(join(tmpdir(), "boggo-koti-"));
  const cwd = project();
  let r = await run(["push", "--prod"], { home, cwd, portal });
  assert.equal(r.code, 1);
  assert.match(r.err, /boggo login/);
  await run(["login"], { home, cwd, portal });
  r = await run(["init", "--name", "varattu", "--yes"], { home, cwd, portal });
  assert.equal(r.code, 1);
  assert.match(r.err, /Nimi varattu on jo käytössä. Vapaita: varattu-2/);
  r = await run(["push"], { home, cwd, portal });
  assert.equal(r.code, 1);
  assert.match(r.err, /boggo init/);
  r = await run(["logout"], { home, cwd, portal });
  assert.equal(r.code, 0);
  assert.equal((await run(["whoami"], { home, cwd, portal })).code, 1);
});

test("BOGGO_TOKEN (CI) toimii ilman tiedostoa", async () => {
  const portal = fakePortal();
  const home = mkdtempSync(join(tmpdir(), "boggo-koti-"));
  const r = await run(["whoami"], { home, cwd: home, portal, env: { BOGGO_TOKEN: TOKEN } });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Boggo Oy \(boggo\) · omistaja/);
});

test(".gitignore-säännöt", () => {
  const rules = [...parseIgnore("dist/\n*.log\n!tärkeä.log\n/juuri.txt\nkuvat/**/*.psd\n"), ...parseIgnore("tmp\n", "web")];
  assert.equal(ignored(rules, "dist", true), true);
  assert.equal(ignored(rules, "dist", false), false);
  assert.equal(ignored(rules, "web/dist", true), true);
  assert.equal(ignored(rules, "a/virhe.log", false), true);
  assert.equal(ignored(rules, "tärkeä.log", false), false);
  assert.equal(ignored(rules, "juuri.txt", false), true);
  assert.equal(ignored(rules, "web/juuri.txt", false), false);
  assert.equal(ignored(rules, "kuvat/a/b/x.psd", false), true);
  assert.equal(ignored(rules, "web/tmp", true), true);
  assert.equal(ignored(rules, "tmp", true), false);
});

test("paketointi: ulos osoittava linkki jää pois, sisäinen mukaan; tar on kelvollinen", async () => {
  const dir = project();
  symlinkSync("/etc/passwd", join(dir, "ulos"));
  symlinkSync("app", join(dir, "sisalla"));
  writeFileSync(join(dir, ".boggoignore"), "app/page.tsx\n");
  const { entries, skipped } = collect(dir);
  assert.deepEqual(skipped, [{ path: "ulos", reason: "link" }]);
  assert.deepEqual(entries.map((e) => e.path), [".boggoignore", "app", "package.json", "sisalla"]);
  const tar = gunzipSync(await packEntries(entries));
  assert.equal(tar.length % 512, 0);
  await assert.rejects(packEntries(entries, { max: 10 }), (e) => e.code === "too_big");
});

test("komentojen tekstit molemmilla kielillä samoilla avaimilla", async () => {
  const { CMD } = await import("../src/command-texts.js");
  const shape = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "object" ? Object.keys(v).sort() : typeof v]));
  assert.deepEqual(shape(CMD.en), shape(CMD.fi));
});

test("init --size pieni: koko Pieni (Donin päätös 26.11.2026)", async () => {
  const portal = fakePortal();
  const home = mkdtempSync(join(tmpdir(), "boggo-koti-"));
  const cwd = project();
  await run(["login"], { home, cwd, portal });
  const r = await run(["init", "--name", "pieni-kauppa", "--size", "pieni", "--yes"], { home, cwd, portal });
  assert.equal(r.code, 0, r.err);
  const created = portal.calls.find((c) => c.path === "/api/cli/projektit" && c.method === "POST");
  assert.equal(JSON.parse(created.body).koko, "pieni");
  assert.equal((await run(["init", "--name", "x", "--size", "jattilainen", "--yes", "--force"], { home, cwd, portal })).code, 1);
});

// Simuloitu kello: sleep siirtää aikaa eteenpäin odottamatta.
function fakeClock() {
  const start = 1_800_000_000_000;
  let t = start;
  return { now: () => t, sleep: async (ms) => void (t += ms), minutes: () => (t - start) / 60_000 };
}

// Yhdistetty kansio ja BOGGO_TOKEN ilman login- ja init-vaiheita.
function linkedProject() {
  const cwd = project();
  mkdirSync(join(cwd, ".boggo"));
  writeFileSync(join(cwd, ".boggo", "projekti.json"), JSON.stringify({ organisaatio: "boggo", projekti: "kauppa", vmid: 1234, portaali: "https://portaali.test" }));
  return cwd;
}
const CI = { BOGGO_TOKEN: TOKEN };
const networkDown = () => {
  throw new TypeError("fetch failed");
};

test("push: verkko katkeaa julkaisun alettua → seuranta päättyy 5 minuutissa paluukoodiin 1", async () => {
  const portal = fakePortal({ follow: networkDown });
  const clock = fakeClock();
  const r = await run(["push", "--prod"], { home: mkdtempSync(join(tmpdir(), "boggo-koti-")), cwd: linkedProject(), portal, env: CI, clock });
  assert.equal(r.code, 1);
  assert.match(r.err, /ei saatu yhteyttä 5 minuuttiin/);
  assert.match(r.err, /https:\/\/portaali.test\/kauppa\/julkaisut/);
  assert.doesNotMatch(r.out, /Julkaistu/);
  assert.ok(clock.minutes() > 5 && clock.minutes() < 6, `seuranta kesti ${clock.minutes()} min`);
});

test("push: lyhyt katko (alle 5 min) ei keskeytä seurantaa", async () => {
  // 100 epäonnistunutta kyselyä × 2 s ≈ 3,3 min, sitten yhteys palaa ja julkaisu valmistuu.
  const portal = fakePortal({
    follow: (reads) => {
      if (reads <= 100) networkDown();
      return new Response(JSON.stringify({ deployment: { status: "valmis" }, steps: [], log: [] }), { status: 200 });
    },
  });
  const r = await run(["push", "--prod"], { home: mkdtempSync(join(tmpdir(), "boggo-koti-")), cwd: linkedProject(), portal, env: CI, clock: fakeClock() });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Julkaistu/);
});

test("push: palvelinvirheet (5xx) lasketaan katkoksi samalla aikarajalla", async () => {
  const portal = fakePortal({ follow: () => new Response("<html>502</html>", { status: 502 }) });
  const clock = fakeClock();
  const r = await run(["push"], { home: mkdtempSync(join(tmpdir(), "boggo-koti-")), cwd: linkedProject(), portal, env: CI, clock });
  assert.equal(r.code, 1);
  assert.match(r.err, /ei saatu yhteyttä 5 minuuttiin/);
  assert.ok(clock.minutes() < 6);
});

test("push: yli 45 minuuttia kestävä julkaisu → seuranta loppuu paluukoodiin 1 (CI ei tulkitse onnistumiseksi)", async () => {
  const portal = fakePortal({
    follow: () => new Response(JSON.stringify({ deployment: { status: "rakennetaan" }, steps: [{ vaihe: "rakennetaan" }], log: [] }), { status: 200 }),
  });
  const clock = fakeClock();
  const r = await run(["push", "--prod"], { home: mkdtempSync(join(tmpdir(), "boggo-koti-")), cwd: linkedProject(), portal, env: CI, clock });
  assert.equal(r.code, 1);
  assert.match(r.err, /Huom\.: Julkaisu kestää yli 45 minuuttia/);
  assert.match(r.err, /https:\/\/portaali.test\/kauppa\/julkaisut/);
  assert.equal(r.out, "");
  assert.ok(clock.minutes() > 45 && clock.minutes() < 46, `seuranta kesti ${clock.minutes()} min`);
});

test("virheellinen BOGGO_TOKEN kerrotaan eikä se näy kirjautumattomuutena", async () => {
  const portal = fakePortal();
  const home = mkdtempSync(join(tmpdir(), "boggo-koti-"));
  const cwd = project();
  assert.equal((await run(["login"], { home, cwd, portal })).code, 0);
  const calls = portal.calls.length;
  const env = { BOGGO_TOKEN: "ei-kelpaa" };
  for (const argv of [["whoami"], ["push", "--prod"], ["login"], ["logout"]]) {
    const r = await run(argv, { home, cwd, portal, env });
    assert.equal(r.code, 1, argv.join(" "));
    assert.match(r.err, /BOGGO_TOKEN arvo ei ole kelvollinen/, argv.join(" "));
    assert.doesNotMatch(r.err, /Kirjaudu ensin/, argv.join(" "));
  }
  assert.equal(portal.calls.length, calls, "virheellisellä tunnuksella ei otettu yhteyttä");
  // Tallennettu kirjautuminen säilyi (logout ei poistanut sitä) ja toimii, kun muuttuja poistetaan.
  assert.equal((await run(["whoami"], { home, cwd, portal })).code, 0);
  // Englanniksi sama.
  const en = await run(["whoami"], { home, cwd, portal, env: { ...env, BOGGO_LANG: "en" } });
  assert.match(en.err, /BOGGO_TOKEN is not a valid token/);
});

const canDenyRead = process.platform !== "win32" && process.getuid?.() !== 0;

test("push: lukukelvoton tiedosto tai kansio → selkeä virhe, ei pinoa eikä lähetystä; .boggoignore ohittaa", { skip: !canDenyRead && "root tai Windows: oikeuksia ei voi estää" }, async () => {
  const portal = fakePortal();
  const home = mkdtempSync(join(tmpdir(), "boggo-koti-"));
  const cwd = linkedProject();
  writeFileSync(join(cwd, "salainen.txt"), "x");
  chmodSync(join(cwd, "salainen.txt"), 0);
  mkdirSync(join(cwd, "data"));
  writeFileSync(join(cwd, "data", "db"), "x");
  chmodSync(join(cwd, "data"), 0);
  try {
    const r = await run(["push", "--prod"], { home, cwd, portal, env: CI });
    assert.equal(r.code, 1);
    assert.match(r.err, /Virhe: Näitä ei voi lukea, joten pakettia ei lähetetty: data \(EACCES\), salainen\.txt \(EACCES\)\./);
    assert.match(r.err, /\.boggoignore/);
    assert.ok(!portal.calls.some((c) => c.path.endsWith("/julkaisut")), "ei lähetystä");

    writeFileSync(join(cwd, ".boggoignore"), "salainen.txt\ndata/\n");
    const ok = await run(["push", "--prod"], { home, cwd, portal, env: CI });
    assert.equal(ok.code, 0, ok.err);
  } finally {
    chmodSync(join(cwd, "data"), 0o755);
  }
});

test("paketointi: tiedosto poistettu läpikäynnin jälkeen → virhe { code: unreadable }", async () => {
  const dir = project();
  const { entries, unreadable } = collect(dir);
  assert.deepEqual(unreadable, []);
  rmSync(join(dir, "app", "page.tsx"));
  await assert.rejects(packEntries(entries), (e) => e.code === "unreadable" && e.path === "app/page.tsx" && e.reason === "ENOENT");
});

// ---------------------------------------------------------------------------------------------------------
// Katselmoinnin kohdat 5–10 (Donin päätös 27.11.2026)

// Pääte: syöte riveinä (Enter = tyhjä rivi), kysymykset stderriin.
async function runTty(argv, { home, cwd, portal, input = [] }) {
  const stdout = sink();
  const stderr = sink();
  stderr.isTTY = true;
  const stdin = new PassThrough();
  stdin.isTTY = true;
  stdin.end(input.map((l) => `${l}\n`).join(""));
  const code = await main({
    argv,
    env: { BOGGO_LANG: "fi", BOGGO_URL: "https://portaali.test", BOGGO_NO_BROWSER: "1" },
    stdout,
    stderr,
    stdin,
    home,
    cwd,
    fetch: portal.fetch,
    sleep: async () => {},
  });
  return { code, out: stdout.text, err: stderr.text };
}

test("5: lähetyksen aikaraja paketin koosta (5–40 min)", () => {
  assert.equal(uploadTimeoutMs(1024), 5 * 60_000);
  assert.equal(uploadTimeoutMs(100 * 1_048_576), 120_000 + 1600 * 1000);
  assert.equal(uploadTimeoutMs(10 * 1024 ** 3), 40 * 60_000);
});

test("5: lähetyksen aikaraja → selkeä viesti ja tarkistusosoite, ei uudelleenlähetystä", async () => {
  const portal = fakePortal({
    upload: () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    },
  });
  const r = await run(["push", "--prod"], { home: mkdtempSync(join(tmpdir(), "boggo-koti-")), cwd: linkedProject(), portal, env: CI });
  assert.equal(r.code, 1);
  assert.match(r.err, /kesti liian kauan/);
  assert.match(r.err, /https:\/\/portaali\.test\/kauppa\/julkaisut/);
  assert.equal(portal.calls.filter((c) => c.path === "/api/cli/projektit/1234/julkaisut").length, 1);
});

test("6: projekti luonnissa tunnistetaan koodista (syy luonti_kesken), ei tekstistä", async () => {
  const portal = fakePortal({ upload: (n, json) => (n === 1 ? json(409, { error: "Project is being created", syy: "luonti_kesken" }) : undefined) });
  const r = await run(["push", "--prod"], { home: mkdtempSync(join(tmpdir(), "boggo-koti-")), cwd: linkedProject(), portal, env: CI });
  assert.equal(r.code, 0, r.err);
  assert.match(r.err, /luonnissa/);
  // Muu 409 ilman koodia ei odota, vaikka tekstissä olisi "valmis"-tyyppinen sana toisella kielellä.
  const other = fakePortal({ upload: (_n, json) => json(409, { error: "Tähän projektiin ei voi julkaista komentoriviltä." }) });
  const r2 = await run(["push", "--prod"], { home: mkdtempSync(join(tmpdir(), "boggo-koti-")), cwd: linkedProject(), portal: other, env: CI });
  assert.equal(r2.code, 1);
  assert.equal(other.calls.filter((c) => c.path === "/api/cli/projektit/1234/julkaisut").length, 1);
});

test("7: selaimen avaus Windowsissa ilman cmd:tä, &-merkki säilyy osana osoitetta", () => {
  const url = "https://cloud.boggo.fi/cli?koodi=KHTR-4MXA&x=1";
  assert.deepEqual(browserCommand("win32", url), ["rundll32", ["url.dll,FileProtocolHandler", url]]);
  assert.deepEqual(browserCommand("darwin", url), ["open", [url]]);
  assert.deepEqual(browserCommand("linux", url), ["xdg-open", [url]]);
});

test("8: CI ja useampi organisaatio: --org pakollinen, ei hiljaista oletusta; ohje kertoo --orgin", async () => {
  const orgs = [{ tunnus: "boggo", nimi: "Boggo Oy", rooli: "owner" }, { tunnus: "lpk", nimi: "LPK", rooli: "admin" }];
  const kauppa = { nimi: "kauppa", vmid: 1234, tyyppi: "palvelin", tila: "valmis", osoite: "https://kauppa.boggo.app", julkaistava: true };
  const cwd = project();
  const portal = fakePortal({ orgs, projects: [kauppa] });
  const r = await run(["push", "--prod", "--project", "kauppa"], { home: mkdtempSync(join(tmpdir(), "boggo-koti-")), cwd, portal, env: CI });
  assert.equal(r.code, 1);
  assert.match(r.err, /--org/);
  assert.equal(portal.calls.filter((c) => c.method === "POST").length, 0);
  const ok = await run(["push", "--prod", "--project", "kauppa", "--org", "lpk"], { home: mkdtempSync(join(tmpdir(), "boggo-koti-")), cwd, portal, env: CI });
  assert.equal(ok.code, 0, ok.err);
  assert.equal(portal.calls.find((c) => c.method === "POST" && c.path === "/api/cli/projektit/1234/julkaisut").org, "lpk");
  const help = await run(["help", "push"], { home: mkdtempSync(join(tmpdir(), "boggo-koti-")), cwd, portal });
  assert.match(help.out + help.err, /--org/);
});

test("9: push yhdistämättömässä kansiossa, initin peruminen → \"Peruttu.\" kerran ja paluukoodi 1", async () => {
  const portal = fakePortal();
  const home = mkdtempSync(join(tmpdir(), "boggo-koti-"));
  const cwd = project();
  await run(["login"], { home, cwd, portal });
  const r = await runTty(["push", "--prod"], { home, cwd, portal, input: ["", "", "", "n"] });
  assert.equal(r.code, 1);
  assert.equal((r.out + r.err).split("Peruttu.").length - 1, 1, r.out + r.err);
  assert.equal(portal.calls.filter((c) => c.method === "POST" && c.path === "/api/cli/projektit").length, 0);
});

test("10: init, portaali ehdottaa muuta käyttöä → oletus Verkkosivu ja pelkkä Enter kelpaa", async () => {
  for (const kaytto of ["muu", null]) {
    const portal = fakePortal({ kaytto });
    const home = mkdtempSync(join(tmpdir(), "boggo-koti-"));
    const cwd = project();
    await run(["login"], { home, cwd, portal });
    const r = await runTty(["init"], { home, cwd, portal, input: ["", "", "", ""] });
    assert.equal(r.code, 0, `${kaytto}: ${r.err}`);
    const created = portal.calls.find((c) => c.path === "/api/cli/projektit" && c.method === "POST");
    assert.equal(JSON.parse(created.body).kaytto, "verkkosivu");
    assert.doesNotMatch(r.err, /Kirjoita numero/);
  }
});

test("login: portaali ilman komentoriviä (401 kirjautumistarkistukselta, 404, 405, HTML) → selkeä viesti, ei tunnusta", async () => {
  const notCli = [
    () => new Response(JSON.stringify({ error: "Kirjaudu sisään." }), { status: 401 }),
    () => new Response(JSON.stringify({ error: "ei löydy" }), { status: 404 }),
    () => new Response("", { status: 405 }),
    () => new Response("<!doctype html><title>Boggo Cloud</title>", { status: 200, headers: { "content-type": "text/html" } }),
  ];
  for (const reply of notCli) {
    const home = mkdtempSync(join(tmpdir(), "boggo-koti-"));
    const portal = { fetch: async () => reply(), calls: [] };
    const r = await run(["login"], { home, cwd: home, portal });
    assert.equal(r.code, 1);
    assert.match(r.err, /^Virhe: Boggo Cloud \(https:\/\/portaali\.test\) ei vielä tue kirjautumista komentoriviltä\./m);
    assert.match(r.err, /Tarkista myös ympäristömuuttuja BOGGO_URL\./, "oma BOGGO_URL mainitaan");
    assert.doesNotMatch(r.err, /Kirjaudu sisään|undefined/);
    assert.throws(() => statSync(join(home, ".boggo", "tunnus.json")), "tunnusta ei tallennettu");
  }
  // Oletusportaali: ei vihjettä BOGGO_URL:sta. Englanniksi sama.
  const home = mkdtempSync(join(tmpdir(), "boggo-koti-"));
  const portal = { fetch: async () => notCli[0](), calls: [] };
  const fi = await run(["login"], { home, cwd: home, portal, env: { BOGGO_URL: "" } });
  assert.match(fi.err, /Boggo Cloud \(https:\/\/cloud\.boggo\.fi\) ei vielä tue/);
  assert.doesNotMatch(fi.err, /BOGGO_URL/);
  const en = await run(["login"], { home, cwd: home, portal, env: { BOGGO_URL: "", BOGGO_LANG: "en" } });
  assert.match(en.err, /^Error: Boggo Cloud \(https:\/\/cloud\.boggo\.fi\) doesn't support logging in from the command line yet\./m);
});

test("login: portaalin omat virheet näytetään sellaisinaan (429 aloituksessa, 410 peruttu selaimessa)", async () => {
  const json = (status, body) => new Response(JSON.stringify(body), { status });
  const home = mkdtempSync(join(tmpdir(), "boggo-koti-"));
  const limited = { fetch: async () => json(429, { error: "Liian monta kirjautumisyritystä. Odota hetki ja yritä uudelleen." }), calls: [] };
  let r = await run(["login"], { home, cwd: home, portal: limited });
  assert.equal(r.code, 1);
  assert.match(r.err, /Virhe: Liian monta kirjautumisyritystä/);

  const cancelled = {
    calls: [],
    fetch: async (url) =>
      new URL(url).pathname === "/api/cli/laite"
        ? json(201, { laitekoodi: "l".repeat(43), kayttajakoodi: "KHTR-4MXA", osoite: "https://portaali.test/cli?koodi=KHTR-4MXA", voimassa_s: 600, valit_s: 2 })
        : json(410, { tila: "peruttu", error: "Kirjautuminen peruttiin selaimessa." }),
  };
  r = await run(["login"], { home, cwd: home, portal: cancelled });
  assert.equal(r.code, 1);
  assert.match(r.err, /Virhe: Kirjautuminen peruttiin selaimessa\./);
  assert.doesNotMatch(r.err, /ei vielä tue/);
});

// ---------------------------------------------------------------------------------------------------------
// Tulosteen ilme (Donin pyyntö 27.11.2026): välit osien väliin, värit ja lihavoinnit vain päätteeseen.

// together: stdout ja stderr samaan virtaan kuten päätteessä (välit lasketaan yhteisestä tulosteesta).
async function runColors(argv, { cwd, portal, env = {}, tty = true, together = false }) {
  const stdout = sink();
  const stderr = together ? stdout : sink();
  stdout.isTTY = tty;
  stderr.isTTY = tty;
  const stdin = new PassThrough();
  stdin.isTTY = false;
  stdin.end();
  const code = await main({
    argv,
    env: { BOGGO_LANG: "fi", BOGGO_URL: "https://portaali.test", BOGGO_NO_BROWSER: "1", ...CI, ...env },
    stdout,
    stderr,
    stdin,
    home: mkdtempSync(join(tmpdir(), "boggo-koti-")),
    cwd,
    fetch: portal.fetch,
    sleep: async () => {},
  });
  return { code, out: stdout.text, err: stderr.text };
}

const ESC = "\u001b[";

test("ilme: välit osien välissä, ei kahta tyhjää riviä peräkkäin, ei värejä putkeen", async () => {
  const cwd = linkedProject();
  const r = await runColors(["push", "--prod"], { cwd, portal: fakePortal(), tty: false, together: true });
  assert.equal(r.code, 0, r.out);
  assert.ok(!r.out.includes(ESC), "ei värikoodeja ilman päätettä");
  assert.match(r.out, /^\nLähetetään 2 tiedostoa/, "tyhjä rivi komennon alussa");
  assert.match(r.out, /aloitettu \(NextJS\)\.\n\n {2}› Puretaan paketti…/);
  assert.match(r.out, /…\n\n✓ Julkaistu \(\d+ s\):\n {2}https:\/\/kauppa\.boggo\.app\n\n$/, "tulos omana osanaan, tyhjä rivi lopussa");
  assert.ok(!r.out.includes("\n\n\n"), "ei kahta tyhjää riviä peräkkäin");

  const fail = await runColors(["push", "--prod"], { cwd, portal: fakePortal({ fail: true }), tty: false, together: true });
  assert.match(fail.out, /…\n\nVirhe: Rakennus epäonnistui\. Katso rakennusloki\.\n\n {2}npm ERR! missing script: build\n\nKoko loki: /);
  assert.ok(!fail.out.includes("\n\n\n"));

  const one = await runColors(["push"], { cwd: linkedProject(), portal: fakePortal(), tty: false, together: true });
  assert.ok(!one.out.includes("\n\n\n"));
});

test("ilme: päätteessä värit ja korostukset, NO_COLOR poistaa ne, --json pysyy puhtaana", async () => {
  const cwd = linkedProject();
  const r = await runColors(["push"], { cwd, portal: fakePortal() });
  assert.equal(r.code, 0, r.err);
  assert.ok(r.err.includes(`${ESC}1mkauppa${ESC}22m`), "projektin nimi lihavoitu");
  assert.ok(r.out.includes(`${ESC}32m✓${ESC}39m`), "onnistuminen vihreällä");
  assert.ok(r.out.includes(`${ESC}36mboggo push --prod${ESC}39m`), "seuraava komento korostettu");

  const fail = await runColors(["push", "--prod"], { cwd, portal: fakePortal({ fail: true }) });
  assert.ok(fail.err.includes(`${ESC}31m${ESC}1mVirhe:${ESC}22m${ESC}39m`), "virhe punaisella");
  assert.ok(fail.err.includes(`${ESC}36mhttps://portaali.test/kauppa/julkaisut${ESC}39m`), "osoite korostettu ilman pistettä");

  const plain = await runColors(["push"], { cwd, portal: fakePortal(), env: { NO_COLOR: "1" } });
  assert.ok(!plain.out.includes(ESC) && !plain.err.includes(ESC));

  const json = await runColors(["whoami", "--json"], { cwd, portal: fakePortal() });
  assert.equal(JSON.parse(json.out).organisaatio, "boggo");
});

// Rakennuksen julkaisu (rakentajan sopimus luku 9, portaalin migraatio 0066): boggo push → boggo promote ilman uutta rakennusta.
function promotePortal({ promotable = true, varsChanged = false } = {}) {
  const base = fakePortal({ follow: () => new Response(JSON.stringify({ deployment: { status: "valmis", promote: promotable }, steps: [], log: [] }), { status: 200 }) });
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetch = async (url, init = {}) => {
    const p = new URL(url).pathname;
    if (p === "/api/cli/projektit/1234/julkaisut/7" && init.method === "POST") {
      base.calls.push({ method: "POST", path: p, body: init.body });
      if (varsChanged && !JSON.parse(init.body).pakota)
        return json(409, { error: "Julkiset ympäristömuuttujat ovat muuttuneet rakennuksen jälkeen.", muuttujat: "muuttuneet" });
      return json(202, { numero: 8, osoite: "https://kauppa.boggo.app" });
    }
    if (p === "/api/cli/projektit/1234/julkaisut/8") {
      base.calls.push({ method: init.method, path: p });
      return json(200, { deployment: { status: "valmis" }, steps: [{ vaihe: "siirretaan", alkoi: "2026-11-27T12:00:00Z" }], log: [] });
    }
    return base.fetch(url, init);
  };
  return { fetch, calls: base.calls };
}

test("promote: push muistaa julkaistavan rakennuksen, promote julkaisee sen ilman uutta pakettia", async () => {
  const portal = promotePortal();
  const home = mkdtempSync(join(tmpdir(), "boggo-koti-"));
  const cwd = linkedProject();
  const built = await run(["push"], { home, cwd, portal, env: CI });
  assert.equal(built.code, 0);
  assert.match(built.out, /boggo promote/);
  assert.equal(JSON.parse(readFileSync(join(cwd, ".boggo", "projekti.json"), "utf8")).rakennus, 7);
  const uploads = portal.calls.filter((c) => c.path === "/api/cli/projektit/1234/julkaisut").length;
  const r = await run(["promote"], { home, cwd, portal, env: CI });
  assert.equal(r.code, 0, r.err);
  assert.match(r.err, /Rakennus #7 tuotantoon: Julkaisu #8 jonossa/);
  assert.match(r.out, /https:\/\/kauppa\.boggo\.app/);
  assert.equal(portal.calls.filter((c) => c.path === "/api/cli/projektit/1234/julkaisut").length, uploads, "ei uutta pakettia");
  assert.deepEqual(JSON.parse(portal.calls.find((c) => c.method === "POST" && c.path.endsWith("/julkaisut/7")).body), {});
});

test("promote: rakennusta ei voi julkaista → vihje --prodiin; ei rakennusta tai väärä numero → selkeä virhe", async () => {
  const portal = promotePortal({ promotable: false });
  const home = mkdtempSync(join(tmpdir(), "boggo-koti-"));
  const cwd = linkedProject();
  const built = await run(["push"], { home, cwd, portal, env: CI });
  assert.match(built.out, /boggo push --prod/);
  assert.doesNotMatch(built.out, /boggo promote/);
  const none = await run(["promote"], { home, cwd, portal, env: CI });
  assert.equal(none.code, 1);
  assert.match(none.err, /ei ole julkaistavaa rakennusta/);
  const bad = await run(["promote", "abc"], { home, cwd, portal, env: CI });
  assert.equal(bad.code, 1);
  assert.match(bad.err, /abc ei ole rakennuksen numero/);
});

test("promote: julkiset muuttujat muuttuneet → CI:ssä virhe ja --force-vihje, --force lähettää pakota", async () => {
  const portal = promotePortal({ varsChanged: true });
  const home = mkdtempSync(join(tmpdir(), "boggo-koti-"));
  const cwd = linkedProject();
  const r = await run(["promote", "7"], { home, cwd, portal, env: CI });
  assert.equal(r.code, 1);
  assert.match(r.err, /muuttuneet/);
  assert.match(r.err, /--force/);
  const f = await run(["promote", "7", "--force"], { home, cwd, portal, env: CI });
  assert.equal(f.code, 0, f.err);
  assert.deepEqual(JSON.parse(portal.calls.filter((c) => c.method === "POST" && c.path.endsWith("/julkaisut/7")).at(-1).body), { pakota: true });
});

// ---------------------------------------------------------------------------------------------------------
// Tietoturvatarkistus (27.11.2026)

test("tietoturva: päätteen ohjauskoodit pois ulkoa tulevasta tekstistä, värikoodit sallitaan", async () => {
  const cwd = linkedProject();
  const evil = "\u001b]52;c;cGFoYQ==\u0007\u001b[2J\u001b[1;1HTyhjä ruutu\r\u001b[31mpunainen\u001b[39m";
  const follow = () =>
    new Response(JSON.stringify({ deployment: { status: "epaonnistui", error: `Virhe ${evil}` }, steps: [], log: [{ vaihe: "rakennetaan", taso: "virhe", teksti: evil }] }), {
      status: 200,
    });
  const r = await run(["push", "--prod"], { home: mkdtempSync(join(tmpdir(), "boggo-koti-")), cwd, portal: fakePortal({ follow }), env: CI });
  assert.equal(r.code, 1);
  assert.ok(!/\u001b\]|\u0007|\u001b\[2J|\u001b\[1;1H|\r/.test(r.err), JSON.stringify(r.err));
  assert.ok(r.err.includes("Tyhjä ruutu\u001b[31mpunainen\u001b[39m"), "värikoodi säilyy");
});

test("tietoturva: tunnus vain https:llä (http vain omalla koneella), virheellinen BOGGO_URL ei kaada", async () => {
  const cwd = linkedProject();
  for (const url of ["http://portaali.test", "ftp://portaali.test", "ei osoite"]) {
    const portal = fakePortal();
    const r = await run(["whoami"], { home: mkdtempSync(join(tmpdir(), "boggo-koti-")), cwd, portal, env: { ...CI, BOGGO_URL: url } });
    assert.equal(r.code, 1, url);
    assert.match(r.err, /pitää alkaa https:\/\//, url);
    assert.equal(portal.calls.length, 0, `${url}: ei yhtään pyyntöä`);
  }
  const portal = fakePortal();
  const local = await run(["whoami"], { home: mkdtempSync(join(tmpdir(), "boggo-koti-")), cwd, portal, env: { ...CI, BOGGO_URL: "http://localhost:3000" } });
  assert.equal(local.code, 0, local.err);
});

test("tietoturva: toisen portaalin kansioyhteys ei julkaise tämän portaalin projektiin", async () => {
  const cwd = linkedProject();
  writeFileSync(join(cwd, ".boggo", "projekti.json"), JSON.stringify({ organisaatio: "boggo", projekti: "kauppa", vmid: 1234, portaali: "https://testi.boggo.fi" }));
  const portal = fakePortal();
  const r = await run(["push", "--prod"], { home: mkdtempSync(join(tmpdir(), "boggo-koti-")), cwd, portal, env: CI });
  assert.equal(r.code, 1);
  assert.match(r.err, /toisessa Boggo Cloudissa \(https:\/\/testi\.boggo\.fi\)/);
  assert.ok(!portal.calls.some((c) => c.path.includes("/julkaisut")), "ei lähetystä");
});
