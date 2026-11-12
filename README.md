# Boggo CLI

Boggo Cloudin (https://cloud.boggo.fi) komentorivityökalu. **Useimmat komennot ovat vielä tulossa.**
_Boggo Cloud command-line tool. Most commands are coming soon. English below._

Kun työkalu valmistuu, sillä voi kirjautua Boggo Cloudiin, yhdistää kansion projektiin, julkaista sovelluksen, hakea
ympäristömuuttujat ja seurata lokeja suoraan omalta koneelta. Kaikki samat toiminnot ovat myös portaalissa.

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
| `boggo login`, `logout`, `whoami` | Kirjautuminen selaimella, uloskirjautuminen, kirjautunut käyttäjä | tulossa |
| `boggo projects`, `link`, `open` | Projektit, kansion yhdistäminen projektiin, projektin avaus selaimessa | tulossa |
| `boggo push` | Rakenna ja tarkista julkaisematta | tulossa |
| `boggo push --prod` | Rakenna ja julkaise tuotantoon | tulossa |
| `boggo env pull`, `env ls` | Ympäristömuuttujat tiedostoon `.env.local`, muuttujien lista | tulossa |
| `boggo logs` | Sovelluksen lokit | tulossa |

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

Boggo Cloud command-line tool. Install with `npm i -g boggo` (Node.js 18 or newer) and run `boggo help`. Working now: `help`,
`--version` and `config language`; the other commands (`login`, `logout`, `whoami`, `projects`, `link`, `push`, `push --prod`,
`env pull`, `env ls`, `logs`, `open`) are coming soon.

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
