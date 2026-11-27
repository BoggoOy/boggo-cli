// Kansion yhteys projektiin: .boggo/projekti.json (organisaatio, projekti, vmid, portaali). Kansio .boggo lisätään .gitignoreen.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const file = (dir) => join(dir, ".boggo", "projekti.json");

export function readLink(dir) {
  try {
    const v = JSON.parse(readFileSync(file(dir), "utf8"));
    return v && typeof v.projekti === "string" && Number.isInteger(v.vmid) ? v : null;
  } catch {
    return null;
  }
}

// Tallentaa yhteyden ja lisää .boggo-kansion .gitignoreen (jos repossa on .gitignore tai .git). true = .gitignore päivitettiin.
export function saveLink(dir, link) {
  mkdirSync(join(dir, ".boggo"), { recursive: true });
  writeFileSync(file(dir), JSON.stringify(link, null, 2) + "\n");
  writeFileSync(join(dir, ".boggo", "README.txt"), "Boggo CLI: tämä kansio yhdistää projektin Boggo Cloudiin (boggo link). Ei kuulu versionhallintaan.\n");
  let text = null;
  try {
    text = readFileSync(join(dir, ".gitignore"), "utf8");
  } catch {
    /* ei .gitignorea */
  }
  if (text !== null && text.split(/\r?\n/).some((l) => /^\/?\.boggo\/?$/.test(l.trim()))) return false;
  if (text === null) {
    try {
      readFileSync(join(dir, ".git", "HEAD"));
    } catch {
      return false;
    }
  }
  appendFileSync(join(dir, ".gitignore"), `${text && !text.endsWith("\n") ? "\n" : ""}.boggo\n`);
  return true;
}

// Projektin nimiehdotus kansion nimestä: pienet kirjaimet, numerot ja väliviivat (portaali tarkistaa lopullisesti).
export function suggestName(dir) {
  const name = basename(dir)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30)
    .replace(/-+$/, "");
  return /^[a-z]/.test(name) ? name : `sovellus${name ? `-${name}` : ""}`.slice(0, 30);
}
