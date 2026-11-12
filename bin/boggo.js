#!/usr/bin/env node
// Boggo CLI (tulossa). Tämä versio varaa paketin nimen: se kertoo vain, että työkalu on tulossa, ja tulostaa versionumeron.
import { readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const args = process.argv.slice(2);

if (args.includes("--version") || args.includes("-v")) {
  console.log(version);
} else {
  console.log("Boggo CLI on tulossa. Seuraa: https://cloud.boggo.fi");
  console.log(`Versio ${version}`);
}
