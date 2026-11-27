// Värit ja korostukset päätteeseen. Vain kun virta on pääte, ei NO_COLORilla (https://no-color.org) eikä TERM=dumb-päätteessä:
// putkeen, tiedostoon ja CI:n lokiin tulee pelkkä teksti.

export function painter(stream, env) {
  const on = Boolean(stream?.isTTY) && !(env.NO_COLOR !== undefined && env.NO_COLOR !== "") && env.TERM !== "dumb";
  const wrap = (open, close) => (s) => (on ? `\u001b[${open}m${s}\u001b[${close}m` : String(s));
  return {
    on,
    bold: wrap(1, 22),
    dim: wrap(2, 22),
    underline: wrap(4, 24),
    red: wrap(31, 39),
    green: wrap(32, 39),
    yellow: wrap(33, 39),
    cyan: wrap(36, 39),
  };
}

// Päätteen ohjauskoodit pois ulkoa tulevasta tekstistä (rakennusloki, portaalin viestit, tiedostonimet): ne voisivat tyhjentää
// ruudun, siirtää kohdistinta, vaihtaa ikkunan otsikon tai kirjoittaa leikepöydälle. Vain värikoodit (SGR, ESC[…m) sallitaan.
const CONTROL_RE = /\u001b(?!\[[0-9;]{1,8}m)|[\u0000-\u0008\u000b-\u001a\u001c-\u001f\u007f-\u009f]/g;

export function safe(text) {
  return String(text).replace(CONTROL_RE, "");
}

// Tekstin sisällä olevat komennot (boggo push --prod) ja osoitteet syaanilla, jotta ohjeen seuraava askel erottuu.
// Osoite päättyy värikoodiin, joten valmiiksi korostettu (esim. alleviivattu) osoite saa värin ilman, että koodit sotkeutuvat.
const COMMAND_RE = /\bboggo [a-z]+(?: --?[a-z]+(?:[ =]<[^>]+>)?)*/g;
const URL_RE = /https?:\/\/[^\s)\u001b]+?(?=[.,:;]?(?:\s|\)|\u001b|$))/g;

export function highlight(paint, text) {
  if (!paint.on) return text;
  return String(text).replace(new RegExp(`${URL_RE.source}|${COMMAND_RE.source}`, "g"), (m) => paint.cyan(m));
}
