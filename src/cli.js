// Boggo CLI:n pääohjelma. main() palauttaa paluukoodin; syötteet ja tulosteet annetaan parametreina, jotta testit voivat ajaa sen.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { context, runCommand } from "./commands.js";
import { readConfig, updateConfig } from "./config.js";
import { askLanguage, canAsk, envLanguage, parseLanguage, systemLanguage } from "./lang.js";
import { COMMANDS, GROUPS, LANGUAGE_SETTING_NAMES, TEXT } from "./messages.js";

export const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

export async function main({
  argv = process.argv.slice(2),
  env = process.env,
  stdout = process.stdout,
  stderr = process.stderr,
  stdin = process.stdin,
  home = homedir(),
  cwd = process.cwd(),
  fetch: fetchImpl = globalThis.fetch,
  sleep,
  now,
} = {}) {
  const args = parseArgs(argv);
  const io = { env, stdout, stderr, stdin, home, cwd, fetch: fetchImpl, sleep, now };

  // Versio ei tarvitse kieltä, joten se ei koskaan kysy mitään (skriptit ajavat sitä).
  if (args.version) {
    stdout.write(`${VERSION}\n`);
    return 0;
  }

  const [command, ...rest] = args.positionals;
  const settingLanguage = command === "config" && LANGUAGE_SETTING_NAMES.includes(rest[0]);
  const config = readConfig(home);
  const base = baseLanguage(env, config);

  // --lang yhdelle komennolle; virheellinen arvo kerrotaan muuten valitulla kielellä.
  if (args.langMissing || args.lang !== undefined) {
    const lang = parseLanguage(args.lang);
    if (!lang) {
      const t = TEXT[base.lang ?? systemLanguage(env)];
      return fail(io, args.langMissing ? t.langNeedsValue : t.unknownLanguage(args.lang));
    }
    return run(io, args, command, rest, { lang, source: "flag" });
  }

  // Ensimmäinen käyttökerta: kysytään kieli ja tallennetaan. Ei, jos komento on itse kielen vaihto.
  if (!base.lang && !settingLanguage && canAsk(io)) {
    const lang = await askLanguage(io);
    if (lang) {
      saveLanguage(io, lang, stderr);
      stderr.write("\n");
      return run(io, args, command, rest, { lang, source: "config" });
    }
  }

  return run(io, args, command, rest, base.lang ? base : { lang: systemLanguage(env), source: "system" });
}

function run(io, args, command, rest, language) {
  const t = TEXT[language.lang];
  const out = painter(io.stdout, io.env);

  if (args.help || command === "help") {
    const topic = command === "help" ? rest : args.positionals;
    if (topic.length === 0) {
      io.stdout.write(fullHelp(language.lang, out));
      return 0;
    }
    const name = topic[0];
    if (!COMMANDS[name]) return fail(io, t.unknownCommand(name));
    io.stdout.write(commandHelp(language.lang, name, out));
    return 0;
  }

  if (command === undefined) {
    if (args.flags.length) return fail(io, t.unknownOption(args.flags[0]));
    io.stdout.write(shortHelp(language.lang, out));
    return 0;
  }

  if (command === "config") return configCommand(io, rest, language);

  if (COMMANDS[command]?.coming) {
    const shown = [command];
    if (command === "env" && ["pull", "ls"].includes(rest[0])) shown.push(rest[0]);
    if (command === "push" && args.flags.includes("--prod")) shown.push("--prod");
    return fail(io, t.comingSoon(shown.join(" ")));
  }

  if (args.badOption) return fail(io, t.unknownOption(args.badOption));
  if (args.missingValue) return fail(io, t.optionNeedsValue(args.missingValue));
  if (LIVE_COMMANDS.includes(command)) return runCommand(context(io, language.lang, args.options, VERSION), command, rest);


  return fail(io, t.unknownCommand(command));
}

async function configCommand(io, rest, language) {
  const t = TEXT[language.lang];
  const out = painter(io.stdout, io.env);
  const [setting, value] = rest;

  if (setting === undefined) {
    io.stdout.write(`\n  ${t.languageCurrent(t.languageNames[language.lang], t.languageSources[language.source])}\n`);
    io.stdout.write(commandHelp(language.lang, "config", out));
    return 0;
  }
  if (!LANGUAGE_SETTING_NAMES.includes(setting)) return fail(io, t.unknownSetting(setting));

  let lang;
  if (value !== undefined) {
    lang = parseLanguage(value);
    if (!lang) return fail(io, t.unknownLanguage(value));
  } else {
    // Kielen vaihto kysyy päätteessä myös silloin, kun BOGGO_LANG on asetettu: käyttäjä pyysi sitä itse.
    const interactive = io.stdout.isTTY && io.stdin.isTTY && !(io.env.CI && io.env.CI !== "false" && io.env.CI !== "0");
    if (!interactive) return fail(io, t.languageNeedsValue);
    lang = await askLanguage(io);
    if (!lang) return fail(io, t.languageNeedsValue);
  }

  if (!saveLanguage(io, lang, io.stdout)) return 1;
  if (envLanguage(io.env).set) io.stdout.write(`${TEXT[lang].languageEnvOverrides}\n`);
  return 0;
}

// Kieli ilman kysymystä: BOGGO_LANG, sitten tallennettu. null = ei kumpaakaan.
function baseLanguage(env, config) {
  const fromEnv = envLanguage(env);
  if (fromEnv.lang) return { lang: fromEnv.lang, source: "env" };
  const saved = parseLanguage(config.language);
  if (saved) return { lang: saved, source: "config" };
  return { lang: null, source: null };
}

function saveLanguage(io, lang, stream) {
  const t = TEXT[lang];
  try {
    updateConfig(io.home, { language: lang });
  } catch (error) {
    io.stderr.write(`${t.configSaveFailed(error.code ?? error.message)}\n`);
    return false;
  }
  stream.write(`${t.languageSaved(t.languageNames[lang])}\n`);
  return true;
}

function fail(io, message) {
  io.stderr.write(`${message}\n`);
  return 1;
}

// Komennot, jotka puhuvat Boggo Cloudin kanssa (src/commands.js).
const LIVE_COMMANDS = ["login", "logout", "whoami", "projects", "init", "link", "push", "open"];
// Valinnat: arvolliset ja kytkimet (options-olion nimi).
const VALUE_OPTIONS = { "--project": "project", "--org": "org", "--name": "name", "--size": "size", "--use": "use" };
const BOOLEAN_OPTIONS = { "--prod": "prod", "--yes": "yes", "-y": "yes", "--json": "json", "--portal": "portal", "--force": "force" };

export function parseArgs(argv) {
  const args = { positionals: [], flags: [], options: {}, help: false, version: false, lang: undefined, langMissing: false, badOption: null, missingValue: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") {
      args.positionals.push(...argv.slice(i + 1));
      break;
    }
    if (arg === "-h" || arg === "--help") args.help = true;
    else if (arg === "-v" || arg === "--version") args.version = true;
    else if (arg === "--lang") {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("-")) args.langMissing = true;
      else {
        args.lang = next;
        i++;
      }
    } else if (arg.startsWith("--lang=")) args.lang = arg.slice("--lang=".length);
    else if (arg.split("=")[0] in VALUE_OPTIONS) {
      const [name, inline] = arg.includes("=") ? [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)] : [arg, undefined];
      const value = inline ?? argv[i + 1];
      if (value === undefined || value === "" || (inline === undefined && value.startsWith("-"))) args.missingValue ??= name;
      else {
        args.options[VALUE_OPTIONS[name]] = value;
        if (inline === undefined) i++;
      }
      args.flags.push(name);
    } else if (arg in BOOLEAN_OPTIONS) {
      args.options[BOOLEAN_OPTIONS[arg]] = true;
      args.flags.push(arg);
    } else if (arg.startsWith("-") && arg !== "-") {
      args.flags.push(arg);
      args.badOption ??= arg;
    }
    else args.positionals.push(arg);
  }
  return args;
}

// Värit vain päätteeseen, ei NO_COLORilla (https://no-color.org) eikä TERM=dumb-päätteessä.
export function painter(stream, env) {
  const on = Boolean(stream?.isTTY) && !(env.NO_COLOR !== undefined && env.NO_COLOR !== "") && env.TERM !== "dumb";
  const wrap = (open, close) => (s) => (on ? `\u001b[${open}m${s}\u001b[${close}m` : String(s));
  return { bold: wrap(1, 22), dim: wrap(2, 22), cyan: wrap(36, 39) };
}

function pad(text, width) {
  return text + " ".repeat(Math.max(0, width - text.length));
}

function fullHelp(lang, out) {
  const t = TEXT[lang];
  const rows = GROUPS.flatMap((g) => g.rows);
  const label = (row) => (lang === "en" && row.cmdEn ? row.cmdEn : row.cmd);
  const cmdWidth = Math.max(...rows.map((r) => label(r).length), ...t.globalOptions.map(([o]) => o.length)) + 3;
  const sumWidth = Math.max(...rows.map((r) => r[lang].length)) + 2;

  const lines = ["", `  ${out.bold(`Boggo CLI ${VERSION}`)}`, "", `  ${t.tagline}`, ""];
  lines.push(`  ${out.bold(t.usageTitle)}`, `    ${t.usageLine}`, "");
  for (const group of GROUPS) {
    lines.push(`  ${out.bold(t.groups[group.id])}`);
    for (const row of group.rows) {
      const summary = row.coming ? `${pad(row[lang], sumWidth)}${out.dim(t.coming)}` : row[lang];
      lines.push(`    ${out.cyan(label(row))}${" ".repeat(cmdWidth - label(row).length)}${summary}`.trimEnd());
    }
    lines.push("");
  }
  lines.push(`  ${out.bold(t.globalOptionsTitle)}`);
  for (const [option, text] of t.globalOptions) lines.push(`    ${out.cyan(option)}${" ".repeat(cmdWidth - option.length)}${text}`);
  lines.push("", `  ${out.bold(t.exampleTitle)}`, `    ${out.cyan("boggo help push")}${" ".repeat(Math.max(2, cmdWidth - "boggo help push".length))}${t.commandHelp}`, "");
  return lines.join("\n") + "\n";
}

function shortHelp(lang, out) {
  const t = TEXT[lang];
  return [
    "",
    `  ${out.bold(`Boggo CLI ${VERSION}`)}`,
    "",
    `  ${t.tagline}`,
    `  ${t.shortNote}`,
    "",
    `  ${out.bold(t.usageTitle)}`,
    `    ${t.usageLine}`,
    "",
    `  ${t.allCommands}: ${out.cyan("boggo help")}`,
    "",
  ].join("\n") + "\n";
}

function commandHelp(lang, name, out) {
  const t = TEXT[lang];
  const command = COMMANDS[name];
  const help = command[lang];
  const title = `boggo ${name}`;
  const lines = ["", `  ${out.bold(title)}${command.coming ? `  ${out.dim(t.coming)}` : ""}`, ""];
  for (const line of help.description) lines.push(`  ${line}`);
  lines.push("", `  ${out.bold(t.usageTitle)}`, `    ${help.usage}`, "");
  const table = (title, rows) => {
    if (!rows.length) return;
    const width = Math.max(...rows.map(([left]) => left.length)) + 3;
    lines.push(`  ${out.bold(title)}`);
    for (const [left, right] of rows) lines.push(`    ${out.cyan(left)}${" ".repeat(width - left.length)}${right}`);
    lines.push("");
  };
  table(t.optionsTitle, help.options);
  table(t.examplesTitle, help.examples);
  return lines.join("\n") + "\n";
}
