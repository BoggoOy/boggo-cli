// Kielen valinta. Järjestys: --lang, BOGGO_LANG, tallennettu (~/.boggo/config.json), ensimmäisellä kerralla kysymys (vain päätteessä),
// järjestelmän kieli (LC_ALL, LC_MESSAGES, LANG), englanti.
import { LANGUAGE_PROMPT, LANGUAGE_PROMPT_RETRY } from "./messages.js";

const CHOICES = {
  fi: ["1", "fi", "suomi", "finnish"],
  en: ["2", "en", "english", "englanti"],
};

// Käyttäjän kirjoittama kieli (--lang, config, kysymys). Tuntematon = null.
export function parseLanguage(value) {
  const v = String(value ?? "").trim().toLowerCase();
  if (!v) return null;
  for (const [lang, words] of Object.entries(CHOICES)) {
    if (words.includes(v)) return lang;
  }
  return null;
}

// Järjestelmän kieliasetus, esim. fi_FI.UTF-8 → fi. Muut kuin suomi = englanti.
export function localeLanguage(value) {
  const v = String(value ?? "").trim().toLowerCase();
  if (/^fi(?:[_.@-]|$)/.test(v)) return "fi";
  if (/^en(?:[_.@-]|$)/.test(v)) return "en";
  return null;
}

export function systemLanguage(env) {
  const locale = env.LC_ALL || env.LC_MESSAGES || env.LANG || "";
  return localeLanguage(locale) ?? "en";
}

export function envLanguage(env) {
  const value = env.BOGGO_LANG;
  if (value === undefined || value === "") return { set: false, lang: null };
  return { set: true, lang: parseLanguage(value) ?? localeLanguage(value) };
}

// Kysytäänkö: vain kun sekä tuloste että syöte ovat pääte, ei CI:ssä eikä kun BOGGO_LANG on asetettu.
export function canAsk({ env, stdout, stdin }) {
  if (!stdout?.isTTY || !stdin?.isTTY) return false;
  if (env.CI && env.CI !== "false" && env.CI !== "0") return false;
  return !envLanguage(env).set;
}

// Kysyy kielen. Palauttaa "fi", "en" tai null (syöte loppui).
export async function askLanguage({ stdin, stderr }) {
  const lines = lineReader(stdin);
  try {
    stderr.write(`${LANGUAGE_PROMPT}\n> `);
    for (;;) {
      const line = await lines.next();
      if (line === null) {
        stderr.write("\n");
        return null;
      }
      const lang = parseLanguage(line);
      if (lang) return lang;
      stderr.write(`${LANGUAGE_PROMPT_RETRY}\n> `);
    }
  } finally {
    lines.close();
  }
}

// Rivit syötteestä jonona, jotta samassa palassa tulleet rivit eivät katoa.
function lineReader(stream) {
  let buffer = "";
  const queue = [];
  let ended = false;
  let waiting = null;
  const wake = () => {
    if (!waiting) return;
    const resolve = waiting;
    if (queue.length) {
      waiting = null;
      resolve(queue.shift());
    } else if (ended) {
      waiting = null;
      resolve(null);
    }
  };
  const onData = (chunk) => {
    buffer += chunk.toString("utf8");
    let index;
    while ((index = buffer.indexOf("\n")) !== -1) {
      queue.push(buffer.slice(0, index).replace(/\r$/, ""));
      buffer = buffer.slice(index + 1);
    }
    wake();
  };
  const onEnd = () => {
    if (buffer) queue.push(buffer);
    buffer = "";
    ended = true;
    wake();
  };
  stream.on("data", onData);
  stream.on("end", onEnd);
  stream.resume?.();
  return {
    next() {
      if (queue.length) return Promise.resolve(queue.shift());
      if (ended) return Promise.resolve(null);
      return new Promise((resolve) => {
        waiting = resolve;
      });
    },
    close() {
      stream.off("data", onData);
      stream.off("end", onEnd);
      stream.pause?.();
    },
  };
}
