// Komennot valeportaalia vasten (ei verkkoa): login → init → push --prod, push ilman --prod, virheet ja paketointi.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";
import { main } from "../src/cli.js";
import { collect, ignored, packEntries, parseIgnore } from "../src/pack.js";

const TOKEN = `boggo_${"t".repeat(43)}`;

function sink() {
  let text = "";
  return { isTTY: false, write: (s) => ((text += s), true), get text() { return text; } };
}

// Valeportaali: vastaa CLI:n reitteihin ja kirjaa pyynnöt.
function fakePortal({ fail } = {}) {
  const calls = [];
  let polls = 0;
  let reads = 0;
  const projects = [];
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
      return json(200, { kayttaja: { sahkoposti: "don@example.com", nimi: "Don" }, organisaatio: "boggo", organisaatiot: [{ tunnus: "boggo", nimi: "Boggo Oy", rooli: "owner" }] });
    if (p === "/api/cli/tunnus") return new Response(null, { status: 204 });
    if (p === "/api/cli/tunnista") {
      const b = JSON.parse(init.body);
      return json(200, { sovellukset: b.tiedostot.includes("package.json") ? [{ kansio: "", tyyppi: "NextJS", kaytto: "verkkosivu", portti: 3000 }] : [] });
    }
    if (p === "/api/cli/nimi") return json(200, u.searchParams.get("nimi") === "varattu" ? { vapaa: false, syy: "Nimi varattu on jo käytössä.", ehdotukset: ["varattu-2"] } : { vapaa: true });
    if (p === "/api/cli/projektit" && init.method === "GET")
      return json(200, { projektit: projects, koot: [{ id: "perus", nimi: "Perus", kuvaus: "1 vCPU", hinta: "9 €/kk + alv" }] });
    if (p === "/api/cli/projektit" && init.method === "POST") {
      const b = JSON.parse(init.body);
      projects.push({ nimi: b.nimi, vmid: 1234, tyyppi: "palvelin", tila: "valmis", osoite: `https://${b.nimi}.boggo.app`, julkaistava: true });
      return json(201, { vmid: 1234, nimi: b.nimi, osoite: `https://${b.nimi}.boggo.app` });
    }
    if (p === "/api/cli/projektit/1234/julkaisut") return json(201, { numero: 7, tavut: init.body.length, tiedostot: 2, sovellus: "NextJS", osoite: "https://kauppa.boggo.app" });
    if (p === "/api/cli/projektit/1234/julkaisut/7") {
      reads++;
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

async function run(argv, { home, cwd, portal, env = {} }) {
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
    sleep: async () => {},
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
