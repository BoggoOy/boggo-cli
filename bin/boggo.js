#!/usr/bin/env node
// Boggo CLI. Ohjelma on kansiossa src/; tämä tiedosto vain käynnistää sen ja asettaa paluukoodin.
import { main } from "../src/cli.js";

// Suljettu putki (esim. boggo help | head -1) ei ole virhe: lopetetaan hiljaa ilman pinoa.
for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", (error) => {
    if (error.code !== "EPIPE") throw error;
    process.exit(process.exitCode ?? 0);
  });
}

process.exitCode = await main();
