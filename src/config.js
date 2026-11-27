// Käyttäjän asetukset: ~/.boggo/config.json (kansio 700, tiedosto 600, koska samassa kansiossa on kirjautumistunnus tunnus.json).
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function configDir(home) {
  return join(home, ".boggo");
}

function configPath(home) {
  return join(configDir(home), "config.json");
}

// Puuttuva tai rikkinäinen tiedosto = ei asetuksia (ei kaadu).
export function readConfig(home) {
  try {
    const value = JSON.parse(readFileSync(configPath(home), "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

// Muuttaa yhden avaimen ja säilyttää muut. Kirjoitus väliaikaiseen tiedostoon ja vaihto, ettei puolikasta tiedostoa jää.
export function updateConfig(home, changes) {
  const dir = configDir(home);
  const file = configPath(home);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const next = { ...readConfig(home), ...changes };
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
  chmodSync(temp, 0o600);
  renameSync(temp, file);
  return next;
}
