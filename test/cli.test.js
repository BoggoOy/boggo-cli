import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { main, parseArgs, VERSION } from "../src/cli.js";
import { localeLanguage, parseLanguage } from "../src/lang.js";
import { COMMANDS, GROUPS, LANGUAGE_PROMPT, TEXT } from "../src/messages.js";

const BIN = fileURLToPath(new URL("../bin/boggo.js", import.meta.url));
const ANSI = /\u001b\[/;

function sink(isTTY = false) {
  let text = "";
  return { isTTY, write: (s) => ((text += s), true), get text() { return text; } };
}

// Ajaa CLI:n muistissa. Oletuksena putki (ei pääte), tyhjä koti ja ei kieliasetuksia.
// Testit eivät koskaan ota yhteyttä oikeaan Boggo Cloudiin: oletuksena verkko on kielletty.
const noNetwork = async () => {
  throw new Error("verkko kielletty testeissä");
};

async function cli(argv, { env = {}, tty = false, input, home, fetch = noNetwork, cwd, sleep = async () => {} } = {}) {
  const stdout = sink(tty);
  const stderr = sink(tty);
  const stdin = new PassThrough();
  stdin.isTTY = tty;
  if (input !== undefined) stdin.end(input);
  const dir = home ?? mkdtempSync(join(tmpdir(), "boggo-test-"));
  const code = await main({ argv, env, stdout, stderr, stdin, home: dir, fetch, cwd: cwd ?? dir, sleep });
  return { code, out: stdout.text, err: stderr.text, home: dir };
}

const FI = { BOGGO_LANG: "fi" };
const EN = { BOGGO_LANG: "en" };

test("--version ja -v tulostavat vain version", async () => {
  for (const flag of ["--version", "-v"]) {
    const r = await cli([flag], { tty: true });
    assert.equal(r.code, 0);
    assert.equal(r.out, `${VERSION}\n`);
    assert.equal(r.err, "", "versio ei kysy kieltä");
  }
  assert.equal(VERSION, "0.1.0");
});

test("help, --help ja -h tulostavat saman ohjeen", async () => {
  const help = await cli(["help"], { env: FI });
  assert.equal(help.code, 0);
  for (const flag of ["--help", "-h"]) {
    const r = await cli([flag], { env: FI });
    assert.equal(r.code, 0);
    assert.equal(r.out, help.out);
  }
});

for (const [lang, env] of [["fi", FI], ["en", EN]]) {
  const t = TEXT[lang];

  test(`[${lang}] pääohje: kuvaus, käyttö, ryhmät, komennot ja yleiset valinnat`, async () => {
    const { out } = await cli(["help"], { env });
    assert.match(out, new RegExp(`Boggo CLI ${VERSION.replaceAll(".", "\\.")}`));
    assert.ok(out.includes(t.tagline));
    assert.ok(out.includes(t.usageLine));
    for (const group of GROUPS) assert.ok(out.includes(t.groups[group.id]), group.id);
    for (const cmd of ["env pull", "env ls", "logs"]) {
      const line = out.split("\n").find((l) => l.trim().startsWith(`${cmd} `) && l.includes(t.coming));
      assert.ok(line, `${cmd} merkitty tulevaksi`);
    }
    for (const cmd of ["login", "logout", "whoami", "init", "projects", "link", "push", "push --prod", "open"]) {
      const line = out.split("\n").find((l) => l.trim().startsWith(`${cmd} `));
      assert.ok(line && !line.includes(t.coming), `${cmd} toimii`);
    }
    const helpLine = out.split("\n").find((l) => l.trim().startsWith("help "));
    assert.ok(helpLine && !helpLine.includes(t.coming), "help toimii");
    const configLine = out.split("\n").find((l) => l.trim().startsWith("config "));
    assert.ok(configLine && !configLine.includes(t.coming), "config toimii");
    for (const [option] of t.globalOptions) assert.ok(out.includes(option), option);
    assert.ok(!ANSI.test(out), "putkeen ei värejä");
  });

  test(`[${lang}] help <komento> näyttää tarkemman ohjeen kaikille komennoille`, async () => {
    for (const name of Object.keys(COMMANDS)) {
      const r = await cli(["help", name], { env });
      assert.equal(r.code, 0, name);
      const help = COMMANDS[name][lang];
      assert.ok(r.out.includes(`boggo ${name}`));
      assert.ok(r.out.includes(help.usage));
      for (const line of help.description) assert.ok(r.out.includes(line));
      for (const [example] of help.examples) assert.ok(r.out.includes(example));
      assert.equal(r.out.includes(t.coming), COMMANDS[name].coming, name);
    }
  });

  test(`[${lang}] help push: kuvaus, --prod ja esimerkki; myös push --help`, async () => {
    const r = await cli(["help", "push"], { env });
    assert.ok(r.out.includes("--prod"));
    assert.ok(r.out.includes("boggo push --prod"));
    assert.ok(r.out.includes(t.optionsTitle));
    assert.ok(r.out.includes(t.examplesTitle));
    assert.equal((await cli(["push", "--help"], { env })).out, r.out);
    assert.equal((await cli(["help", "push", "--prod"], { env })).out, r.out);
    assert.equal((await cli(["help", "env", "pull"], { env })).out, (await cli(["help", "env"], { env })).out);
  });

  test(`[${lang}] tuntematon komento: viesti ja paluukoodi 1`, async () => {
    const r = await cli(["x"], { env });
    assert.equal(r.code, 1);
    assert.equal(r.out, "");
    assert.equal(r.err, `${t.unknownCommand("x")}\n`);
    const h = await cli(["help", "x"], { env });
    assert.equal(h.code, 1);
    assert.equal(h.err, `${t.unknownCommand("x")}\n`);
    const o = await cli(["--foo"], { env });
    assert.equal(o.code, 1);
    assert.equal(o.err, `${t.unknownOption("--foo")}\n`);
  });

  test(`[${lang}] pelkkä boggo näyttää lyhyen ohjeen`, async () => {
    const r = await cli([], { env });
    assert.equal(r.code, 0);
    assert.ok(r.out.includes(t.tagline));
    assert.ok(r.out.includes(t.shortNote));
    assert.ok(r.out.includes("boggo help"));
    assert.ok(!r.out.includes(t.groups.account), "ei komentoluetteloa");
  });

  test(`[${lang}] tulevat komennot: "tulossa" ja paluukoodi 1`, async () => {
    for (const [argv, shown] of [
      [["env", "pull"], "env pull"],
      [["env", "ls"], "env ls"],
      [["logs", "--follow"], "logs"],
    ]) {
      const r = await cli(argv, { env });
      assert.equal(r.code, 1, shown);
      assert.equal(r.err, `${t.comingSoon(shown)}\n`);
    }
  });
}

test("odotetut tekstit sellaisinaan", async () => {
  assert.equal((await cli(["x"], { env: FI })).err, "Tuntematon komento: x. Katso boggo help.\n");
  assert.equal((await cli(["x"], { env: EN })).err, "Unknown command: x. See boggo help.\n");
  assert.equal(LANGUAGE_PROMPT, "Valitse kieli / Choose language: 1) Suomi 2) English");
});

test("tekstit ovat molemmilla kielillä samanmuotoisina", () => {
  const keys = (o) => Object.keys(o).sort();
  assert.deepEqual(keys(TEXT.fi), keys(TEXT.en));
  for (const key of Object.keys(TEXT.fi)) {
    assert.equal(typeof TEXT.fi[key], typeof TEXT.en[key], key);
    if (typeof TEXT.fi[key] === "object" && !Array.isArray(TEXT.fi[key])) assert.deepEqual(keys(TEXT.fi[key]), keys(TEXT.en[key]), key);
  }
  assert.equal(TEXT.fi.globalOptions.length, TEXT.en.globalOptions.length);
  for (const group of GROUPS) for (const row of group.rows) assert.ok(row.fi && row.en, row.cmd);
  for (const [name, command] of Object.entries(COMMANDS)) {
    for (const part of ["usage", "description", "options", "examples"]) assert.ok(command.fi[part] && command.en[part], `${name}.${part}`);
    assert.equal(command.fi.options.length, command.en.options.length, name);
    assert.deepEqual(
      command.fi.options.map(([o]) => o.split(" ")[0]),
      command.en.options.map(([o]) => o.split(" ")[0]),
      `${name}: samat valinnat`,
    );
    assert.equal(command.fi.examples.length, command.en.examples.length, name);
  }
});

test("värit vain päätteeseen, NO_COLOR ja TERM=dumb poistavat ne", async () => {
  const tty = await cli(["help"], { env: FI, tty: true });
  assert.ok(ANSI.test(tty.out));
  assert.ok(!ANSI.test((await cli(["help"], { env: { ...FI, NO_COLOR: "1" }, tty: true })).out));
  assert.ok(!ANSI.test((await cli(["help"], { env: { ...FI, TERM: "dumb" }, tty: true })).out));
  // Tyhjä NO_COLOR ei poista värejä (no-color.org).
  assert.ok(ANSI.test((await cli(["help"], { env: { ...FI, NO_COLOR: "" }, tty: true })).out));
  // Värien kanssa ja ilman sama teksti.
  assert.equal(tty.out.replace(/\u001b\[\d+m/g, ""), (await cli(["help"], { env: FI })).out);
});

test("ensimmäinen käyttökerta päätteessä kysyy kielen ja tallentaa sen (600)", async () => {
  const r = await cli(["help"], { tty: true, input: "2\n" });
  assert.equal(r.code, 0);
  assert.ok(r.err.startsWith(LANGUAGE_PROMPT));
  assert.ok(r.err.includes(TEXT.en.languageSaved("English")));
  assert.ok(r.out.includes(TEXT.en.tagline));
  const file = join(r.home, ".boggo", "config.json");
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { language: "en" });
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(statSync(join(r.home, ".boggo")).mode & 0o777, 0o700);

  // Toisella kerralla ei kysytä.
  const again = await cli(["help"], { tty: true, home: r.home });
  assert.equal(again.err, "");
  assert.ok(again.out.includes(TEXT.en.tagline));
});

test("kysymys: väärä vastaus kysytään uudelleen, sana kelpaa", async () => {
  const r = await cli([], { tty: true, input: "3\nsuomi\n" });
  assert.ok(r.err.includes(TEXT.fi.languageSaved("suomi")));
  assert.ok(r.err.includes("Kirjoita 1 tai 2 / Type 1 or 2"));
  assert.ok(r.out.includes(TEXT.fi.tagline));
});

test("kysymys: syötteen loppu ilman vastausta = järjestelmän kieli, ei tallennusta", async () => {
  const r = await cli(["help"], { tty: true, input: "", env: { LANG: "fi_FI.UTF-8" } });
  assert.equal(r.code, 0);
  assert.ok(r.out.includes(TEXT.fi.tagline));
  assert.ok(!existsSync(join(r.home, ".boggo", "config.json")));
});

test("ei kysytä putkessa, CI:ssä eikä BOGGO_LANGilla", async () => {
  for (const [opts, expected] of [
    [{ env: { LANG: "fi_FI.UTF-8" } }, "fi"], // putki: järjestelmän kieli
    [{ env: { LANG: "de_DE.UTF-8" } }, "en"], // muu kuin suomi: englanti
    [{ env: {} }, "en"], // ei kieltä: englanti
    [{ env: { LC_ALL: "fi_FI.UTF-8", LANG: "en_US.UTF-8" } }, "fi"],
    [{ env: { CI: "true", LANG: "fi_FI.UTF-8" }, tty: true }, "fi"],
    [{ env: { BOGGO_LANG: "en", LANG: "fi_FI.UTF-8" }, tty: true }, "en"],
    [{ env: { BOGGO_LANG: "fi_FI.UTF-8" }, tty: true }, "fi"],
    [{ env: { BOGGO_LANG: "sv", LANG: "fi_FI.UTF-8" }, tty: true }, "fi"], // tuntematon BOGGO_LANG: ei kysytä, järjestelmän kieli
  ]) {
    const r = await cli(["help"], opts);
    assert.equal(r.err, "", JSON.stringify(opts));
    assert.ok(r.out.includes(TEXT[expected].tagline), JSON.stringify(opts));
    assert.ok(!existsSync(join(r.home, ".boggo")), "ei tallennusta");
  }
});

test("järjestys: --lang > BOGGO_LANG > tallennettu > järjestelmä", async () => {
  const home = mkdtempSync(join(tmpdir(), "boggo-test-"));
  mkdirSync(join(home, ".boggo"));
  writeFileSync(join(home, ".boggo", "config.json"), JSON.stringify({ language: "fi" }));
  const run = async (argv, env = {}) => (await cli(argv, { env, home, tty: true })).out;
  assert.ok((await run(["help"], { LANG: "en_US.UTF-8" })).includes(TEXT.fi.tagline));
  assert.ok((await run(["help"], { BOGGO_LANG: "en" })).includes(TEXT.en.tagline));
  assert.ok((await run(["help", "--lang", "en"])).includes(TEXT.en.tagline));
  assert.ok((await run(["help", "--lang=en"], { BOGGO_LANG: "fi" })).includes(TEXT.en.tagline));
  assert.ok((await run(["--lang", "fi", "help"], { BOGGO_LANG: "en" })).includes(TEXT.fi.tagline));
});

test("--lang ilman ensimmäistä kertaa ei kysy eikä tallenna", async () => {
  const r = await cli(["help", "--lang", "fi"], { tty: true });
  assert.equal(r.err, "");
  assert.ok(r.out.includes(TEXT.fi.tagline));
  assert.ok(!existsSync(join(r.home, ".boggo")));
});

test("--lang väärällä arvolla: virhe nykyisellä kielellä", async () => {
  const r = await cli(["help", "--lang", "sv"], { env: { LANG: "fi_FI.UTF-8" } });
  assert.equal(r.code, 1);
  assert.equal(r.err, "Tuntematon kieli: sv. Vaihtoehdot: fi, en.\n");
  const e = await cli(["help", "--lang"], { env: EN });
  assert.equal(e.code, 1);
  assert.equal(e.err, `${TEXT.en.langNeedsValue}\n`);
});

test("rikkinäinen config.json ei kaada, ja se korjataan tallennuksessa", async () => {
  const home = mkdtempSync(join(tmpdir(), "boggo-test-"));
  mkdirSync(join(home, ".boggo"));
  writeFileSync(join(home, ".boggo", "config.json"), "{ rikki");
  const r = await cli(["help"], { home, env: { LANG: "fi_FI.UTF-8" } });
  assert.equal(r.code, 0);
  assert.ok(r.out.includes(TEXT.fi.tagline));
  const c = await cli(["config", "kieli", "en"], { home });
  assert.equal(c.code, 0);
  assert.deepEqual(JSON.parse(readFileSync(join(home, ".boggo", "config.json"), "utf8")), { language: "en" });
});

for (const [setting, value, lang] of [["kieli", "en", "en"], ["language", "fi", "fi"], ["kieli", "suomi", "fi"], ["language", "English", "en"]]) {
  test(`config ${setting} ${value} tallentaa kielen ${lang} ja säilyttää muut asetukset`, async () => {
    const home = mkdtempSync(join(tmpdir(), "boggo-test-"));
    mkdirSync(join(home, ".boggo"));
    writeFileSync(join(home, ".boggo", "config.json"), JSON.stringify({ language: lang === "fi" ? "en" : "fi", muu: 1 }));
    const r = await cli(["config", setting, value], { home });
    assert.equal(r.code, 0);
    assert.equal(r.out, `${TEXT[lang].languageSaved(TEXT[lang].languageNames[lang])}\n`);
    const file = join(home, ".boggo", "config.json");
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { language: lang, muu: 1 });
    assert.equal(statSync(file).mode & 0o777, 0o600);
  });
}

test("config kieli ilman arvoa: päätteessä kysyy, putkessa virhe", async () => {
  const asked = await cli(["config", "kieli"], { tty: true, input: "1\n", env: { BOGGO_LANG: "en" } });
  assert.equal(asked.code, 0);
  assert.ok(asked.err.startsWith(LANGUAGE_PROMPT));
  assert.ok(asked.out.includes(TEXT.fi.languageSaved("suomi")));
  assert.ok(asked.out.includes(TEXT.fi.languageEnvOverrides), "BOGGO_LANG ohittaa tallennetun");

  const piped = await cli(["config", "language"], { env: EN });
  assert.equal(piped.code, 1);
  assert.equal(piped.err, `${TEXT.en.languageNeedsValue}\n`);
});

test("config: väärä kieli ja tuntematon asetus", async () => {
  const bad = await cli(["config", "kieli", "sv"], { env: FI });
  assert.equal(bad.code, 1);
  assert.equal(bad.err, "Tuntematon kieli: sv. Vaihtoehdot: fi, en.\n");
  const unknown = await cli(["config", "teema"], { env: EN });
  assert.equal(unknown.code, 1);
  assert.equal(unknown.err, "Unknown setting: teema. See boggo help config.\n");
  const show = await cli(["config"], { env: FI });
  assert.equal(show.code, 0);
  assert.ok(show.out.includes("Kieli: suomi (ympäristömuuttuja BOGGO_LANG)"));
});

test("kielen tulkinta", () => {
  assert.equal(parseLanguage("1"), "fi");
  assert.equal(parseLanguage(" FI "), "fi");
  assert.equal(parseLanguage("2"), "en");
  assert.equal(parseLanguage("sv"), null);
  assert.equal(localeLanguage("fi_FI.UTF-8"), "fi");
  assert.equal(localeLanguage("fi"), "fi");
  assert.equal(localeLanguage("fil_PH.UTF-8"), null, "filipino ei ole suomi");
  assert.equal(localeLanguage("C"), null);
});

test("argumenttien jäsennys", () => {
  assert.deepEqual(parseArgs(["push", "--prod", "--lang", "en"]), {
    positionals: ["push"],
    flags: ["--prod"],
    options: { prod: true },
    help: false,
    version: false,
    lang: "en",
    langMissing: false,
    badOption: null,
    missingValue: null,
  });
  assert.deepEqual(parseArgs(["init", "--name=kauppa", "--size", "iso", "-y"]).options, { name: "kauppa", size: "iso", yes: true });
  assert.equal(parseArgs(["push", "--projekti"]).badOption, "--projekti");
  assert.equal(parseArgs(["push", "--project"]).missingValue, "--project");
  assert.equal(parseArgs(["-h"]).help, true);
  assert.deepEqual(parseArgs(["--", "--help"]).positionals, ["--help"]);
});

test("bin/boggo.js: paluukoodi ja tuloste oikeana prosessina", () => {
  const env = { PATH: process.env.PATH, BOGGO_LANG: "fi", HOME: mkdtempSync(join(tmpdir(), "boggo-test-")) };
  const ok = spawnSync(process.execPath, [BIN, "--version"], { env, encoding: "utf8" });
  assert.equal(ok.status, 0);
  assert.equal(ok.stdout, `${VERSION}\n`);
  const bad = spawnSync(process.execPath, [BIN, "x"], { env, encoding: "utf8" });
  assert.equal(bad.status, 1);
  assert.equal(bad.stderr, "Tuntematon komento: x. Katso boggo help.\n");
  const help = spawnSync(process.execPath, [BIN, "help"], { env, encoding: "utf8" });
  assert.equal(help.status, 0);
  assert.ok(help.stdout.includes(TEXT.fi.tagline));
});

test("suljettu putki ei kaada eikä tulosta pinoa", () => {
  const env = { PATH: process.env.PATH, BOGGO_LANG: "fi", HOME: mkdtempSync(join(tmpdir(), "boggo-test-")) };
  const r = spawnSync("/bin/sh", ["-c", `for i in 1 2 3 4 5 6 7 8 9 10; do "${process.execPath}" "${BIN}" help; done | head -1`], { env, encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.equal(r.stderr, "");
});
