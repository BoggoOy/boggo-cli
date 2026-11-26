# Boggo CLI

Boggo Cloudin (https://cloud.boggo.fi) komentorivityökalu: luo projekti ja julkaise se omalta koneelta.
_Boggo Cloud command-line tool. English below._

```sh
npx boggo login          # kirjaudu selaimella
npx boggo init           # luo projekti tästä kansiosta (tai valitse olemassa oleva)
npx boggo push --prod    # julkaise: https://<nimi>.boggo.app
```

`boggo push` ilman `--prod` rakentaa julkaisematta. Kaikki samat toiminnot ovat myös portaalissa.

## Asennus

```sh
npm i -g boggo
boggo help
```

Tai ilman asennusta: `npx boggo help`. Vaatii Node.js 18:n tai uudemman.

## Komennot

| Komento | Mitä tekee | Tila |
|---|---|---|
| `boggo help [komento]` | Kaikki komennot tai yhden komennon ohje (myös `--help`, `-h`) | toimii |
| `boggo --version` | Versio (myös `-v`) | toimii |
| `boggo config kieli [fi\|en]` | Vaihda kieli | toimii |
| `boggo login`, `logout`, `whoami` | Kirjautuminen selaimella, uloskirjautuminen, kirjautunut käyttäjä | toimii |
| `boggo init` | Luo projekti tästä kansiosta (tunnistaa sovelluksen, kysyy nimen, käytön ja koon) | toimii |
| `boggo projects`, `link`, `open` | Projektit, kansion yhdistäminen projektiin, projektin avaus selaimessa | toimii |
| `boggo push` | Rakenna ja tarkista julkaisematta | toimii |
| `boggo push --prod` | Rakenna ja julkaise tuotantoon | toimii |
| `boggo env pull`, `env ls` | Ympäristömuuttujat tiedostoon `.env.local`, muuttujien lista | tulossa |
| `boggo logs` | Sovelluksen lokit | tulossa |

Paketista jäävät pois `.git`, `node_modules`, `.boggo`, `.env`-tiedostot (paitsi esimerkit), kehysten välimuistit (`.next` ym.),
`.gitignoren` ja `.boggoignoren` tiedostot sekä yli 50 Mt:n tiedostot; raja 100 Mt pakattuna. Kirjautumistunnus on tiedostossa
`~/.boggo/tunnus.json` (600); CI:ssä ympäristömuuttuja `BOGGO_TOKEN`. Kansion yhteys on kansiossa `.boggo` (lisätään .gitignoreen).

`boggo push` päättyy paluukoodiin 0 vain, kun rakennus tai julkaisu onnistui. Jos julkaisu kestää yli 45 minuuttia tai
Boggo Cloudiin ei saada yhteyttä 5 minuuttiin, seuranta loppuu paluukoodiin 1 (julkaisu jatkuu portaalissa).

Tuleva komento kertoo olevansa tulossa ja päättyy paluukoodiin 1. Tuntematon komento: `Tuntematon komento: x. Katso boggo help.`
ja paluukoodi 1.

## Kieli

Suomi ja englanti. Ensimmäisellä käyttökerralla päätteessä työkalu kysyy kielen ja tallentaa sen tiedostoon
`~/.boggo/config.json` (oikeudet 600). Vaihto: `boggo config kieli` (tai `boggo config language`), yhdelle komennolle `--lang fi|en`.

Kieli valitaan tässä järjestyksessä:

1. `--lang fi|en`
2. ympäristömuuttuja `BOGGO_LANG`
3. tallennettu valinta (`~/.boggo/config.json`)
4. kysymys, kun tuloste ja syöte ovat pääte (ei koskaan putkessa, CI:ssä tai kun `BOGGO_LANG` on asetettu)
5. järjestelmän kieli (`LC_ALL`, `LC_MESSAGES`, `LANG`): suomi, jos se on suomi, muuten englanti

Värit vain päätteessä; `NO_COLOR` poistaa ne.

## English

Boggo Cloud command-line tool. Install with `npm i -g boggo` (Node.js 18 or newer) and run `boggo help`. Create and deploy a
project: `boggo login`, then in your project folder `boggo init` and `boggo push --prod` (without `--prod` it only builds). Also
`whoami`, `projects`, `link`, `open` and `logout`; `env pull`, `env ls` and `logs` are coming soon. In CI set `BOGGO_TOKEN`; `boggo push`
exits with 0 only when the build or deployment succeeded.

On first use in a terminal, the tool asks for your language and saves it in `~/.boggo/config.json`. Change it with
`boggo config language`, or use `--lang fi|en` for one command. In pipes and CI it never asks: it uses `BOGGO_LANG`, then the
system language (`LANG`), then English. Colors only in a terminal; `NO_COLOR` turns them off.

## Kehitys

```sh
npm test
```

Ei riippuvuuksia. Kaikki tekstit molemmilla kielillä ovat tiedostossa `src/messages.js`.

## Lisenssi

MIT © Boggo Oy
