// Kaikki Boggo CLI:n tekstit suomeksi ja englanniksi. Uusi teksti lisätään molemmille kielille (testi tarkistaa).
// Komentojen nimet ja valinnat ovat samat kummallakin kielellä; vain selitykset käännetään.

export const LANGS = ["fi", "en"];

export const SITE_URL = "https://cloud.boggo.fi";

// Ensimmäisen käyttökerran kysymys on aina kaksikielinen, koska kieltä ei vielä tiedetä.
export const LANGUAGE_PROMPT = "Valitse kieli / Choose language: 1) Suomi 2) English";
export const LANGUAGE_PROMPT_RETRY = "Kirjoita 1 tai 2 / Type 1 or 2";

export const TEXT = {
  fi: {
    tagline: "Boggo Cloudin komentorivityökalu: julkaise ja hallitse projekteja omalta koneeltasi.",
    shortNote: "Aloita: boggo login, sitten projektin kansiossa boggo init ja boggo push --prod.",
    usageTitle: "Käyttö",
    usageLine: "boggo <komento> [valinnat]",
    allCommands: "Kaikki komennot",
    commandHelp: "Yhden komennon ohje",
    optionsTitle: "Valinnat",
    examplesTitle: "Esimerkit",
    globalOptionsTitle: "Yleiset valinnat",
    exampleTitle: "Esimerkki",
    coming: "(tulossa)",
    groups: {
      account: "Tili",
      projects: "Projektit",
      deploy: "Julkaisu",
      env: "Ympäristömuuttujat",
      other: "Muut",
    },
    globalOptions: [
      ["-h, --help", "Näytä ohje"],
      ["-v, --version", "Näytä versio"],
      ["--lang fi|en", "Käytä kieltä tässä komennossa"],
    ],
    unknownCommand: (name) => `Tuntematon komento: ${name}. Katso boggo help.`,
    unknownOption: (name) => `Tuntematon valinta: ${name}. Katso boggo help.`,
    optionNeedsValue: (name) => `Valinta ${name} tarvitsee arvon.`,
    unknownLanguage: (value) => `Tuntematon kieli: ${value}. Vaihtoehdot: fi, en.`,
    langNeedsValue: "Valinta --lang tarvitsee arvon: fi tai en.",
    unknownSetting: (name) => `Tuntematon asetus: ${name}. Katso boggo help config.`,
    comingSoon: (command) => `boggo ${command} on vielä tulossa. Seuraa: ${SITE_URL}`,
    languageNames: { fi: "suomi", en: "englanti" },
    languageSaved: (name) => `Kieli tallennettu: ${name}. Vaihda: boggo config kieli`,
    languageCurrent: (name, source) => `Kieli: ${name} (${source})`,
    languageSources: {
      flag: "valinta --lang",
      env: "ympäristömuuttuja BOGGO_LANG",
      config: "tallennettu",
      system: "järjestelmän kieli",
    },
    languageNeedsValue: "Anna kieli: boggo config kieli fi tai boggo config kieli en.",
    languageEnvOverrides: "Huom.: ympäristömuuttuja BOGGO_LANG ohittaa tallennetun kielen.",
    configSaveFailed: (reason) => `Asetusta ei voitu tallentaa (${reason}).`,
  },
  en: {
    tagline: "Boggo Cloud command-line tool: deploy and manage projects from your own machine.",
    shortNote: "Start: boggo login, then in your project folder boggo init and boggo push --prod.",
    usageTitle: "Usage",
    usageLine: "boggo <command> [options]",
    allCommands: "All commands",
    commandHelp: "Help for one command",
    optionsTitle: "Options",
    examplesTitle: "Examples",
    globalOptionsTitle: "Global options",
    exampleTitle: "Example",
    coming: "(coming soon)",
    groups: {
      account: "Account",
      projects: "Projects",
      deploy: "Deploy",
      env: "Environment variables",
      other: "Other",
    },
    globalOptions: [
      ["-h, --help", "Show help"],
      ["-v, --version", "Show version"],
      ["--lang fi|en", "Use a language for this command"],
    ],
    unknownCommand: (name) => `Unknown command: ${name}. See boggo help.`,
    unknownOption: (name) => `Unknown option: ${name}. See boggo help.`,
    optionNeedsValue: (name) => `Option ${name} needs a value.`,
    unknownLanguage: (value) => `Unknown language: ${value}. Choices: fi, en.`,
    langNeedsValue: "Option --lang needs a value: fi or en.",
    unknownSetting: (name) => `Unknown setting: ${name}. See boggo help config.`,
    comingSoon: (command) => `boggo ${command} is coming soon. Follow: ${SITE_URL}`,
    languageNames: { fi: "Finnish", en: "English" },
    languageSaved: (name) => `Language saved: ${name}. To change: boggo config language`,
    languageCurrent: (name, source) => `Language: ${name} (${source})`,
    languageSources: {
      flag: "option --lang",
      env: "environment variable BOGGO_LANG",
      config: "saved",
      system: "system language",
    },
    languageNeedsValue: "Give a language: boggo config language fi or boggo config language en.",
    languageEnvOverrides: "Note: the environment variable BOGGO_LANG overrides the saved language.",
    configSaveFailed: (reason) => `Could not save the setting (${reason}).`,
  },
};

// Pääohjeen rivit ryhmittäin. topic = komento, jonka tarkempi ohje (boggo help <topic>) kertoo rivistä.
export const GROUPS = [
  {
    id: "account",
    rows: [
      { cmd: "login", topic: "login", coming: false, fi: "Kirjaudu Boggo Cloudiin selaimella", en: "Log in to Boggo Cloud with your browser" },
      { cmd: "logout", topic: "logout", coming: false, fi: "Kirjaudu ulos tältä koneelta", en: "Log out on this machine" },
      { cmd: "whoami", topic: "whoami", coming: false, fi: "Näytä kirjautunut käyttäjä", en: "Show the logged-in user" },
    ],
  },
  {
    id: "projects",
    rows: [
      { cmd: "init", topic: "init", coming: false, fi: "Luo projekti tästä kansiosta", en: "Create a project from this folder" },
      { cmd: "projects", topic: "projects", coming: false, fi: "Listaa organisaation projektit", en: "List your organization's projects" },
      { cmd: "link", topic: "link", coming: false, fi: "Yhdistä kansio projektiin", en: "Link this folder to a project" },
      { cmd: "open", topic: "open", coming: false, fi: "Avaa projekti selaimessa", en: "Open the project in your browser" },
    ],
  },
  {
    id: "deploy",
    rows: [
      { cmd: "push", topic: "push", coming: false, fi: "Rakenna ja tarkista julkaisematta", en: "Build and check without deploying" },
      { cmd: "push --prod", topic: "push", coming: false, fi: "Rakenna ja julkaise tuotantoon", en: "Build and deploy to production" },
      { cmd: "logs", topic: "logs", coming: true, fi: "Näytä sovelluksen lokit", en: "Show the app's logs" },
    ],
  },
  {
    id: "env",
    rows: [
      { cmd: "env pull", topic: "env", coming: true, fi: "Hae muuttujat tiedostoon .env.local", en: "Download variables to .env.local" },
      { cmd: "env ls", topic: "env", coming: true, fi: "Listaa muuttujat", en: "List variables" },
    ],
  },
  {
    id: "other",
    rows: [
      { cmd: "help [komento]", cmdEn: "help [command]", topic: "help", coming: false, fi: "Näytä ohje", en: "Show help" },
      { cmd: "config kieli", cmdEn: "config language", topic: "config", coming: false, fi: "Vaihda kieli (suomi tai englanti)", en: "Change the language (Finnish or English)" },
    ],
  },
];

// Komentojen tarkemmat ohjeet (boggo help <komento>). Valinnat ja esimerkit: [komento tai valinta, selitys].
export const COMMANDS = {
  login: {
    coming: false,
    fi: {
      usage: "boggo login",
      description: [
        "Kirjautuu Boggo Cloudiin selaimella. Komento avaa kirjautumissivun ja näyttää koodin,",
        "jonka vahvistat portaalissa. Tunnus tallennetaan tälle koneelle.",
      ],
      options: [],
      examples: [["boggo login", "Kirjaudu sisään"]],
    },
    en: {
      usage: "boggo login",
      description: [
        "Logs in to Boggo Cloud with your browser. The command opens the login page and shows a code",
        "that you confirm in the portal. The token is saved on this machine.",
      ],
      options: [],
      examples: [["boggo login", "Log in"]],
    },
  },
  logout: {
    coming: false,
    fi: {
      usage: "boggo logout",
      description: ["Poistaa tunnuksen tältä koneelta ja mitätöi sen Boggo Cloudissa."],
      options: [],
      examples: [["boggo logout", "Kirjaudu ulos"]],
    },
    en: {
      usage: "boggo logout",
      description: ["Removes the token from this machine and revokes it in Boggo Cloud."],
      options: [],
      examples: [["boggo logout", "Log out"]],
    },
  },
  whoami: {
    coming: false,
    fi: {
      usage: "boggo whoami",
      description: ["Näyttää, kenellä tunnuksella olet kirjautunut ja mihin organisaatioihin kuulut."],
      options: [],
      examples: [["boggo whoami", "Näytä käyttäjä ja organisaatiot"]],
    },
    en: {
      usage: "boggo whoami",
      description: ["Shows who you are logged in as and which organizations you belong to."],
      options: [],
      examples: [["boggo whoami", "Show user and organizations"]],
    },
  },
  projects: {
    coming: false,
    fi: {
      usage: "boggo projects [valinnat]",
      description: ["Listaa organisaation projektit, niiden tilan ja osoitteen."],
      options: [
        ["--org <tunniste>", "Organisaatio, jos kuulut useampaan"],
        ["--json", "Koneluettava tuloste"],
      ],
      examples: [["boggo projects", "Listaa projektit"]],
    },
    en: {
      usage: "boggo projects [options]",
      description: ["Lists your organization's projects with their status and address."],
      options: [
        ["--org <slug>", "Organization, if you belong to several"],
        ["--json", "Machine-readable output"],
      ],
      examples: [["boggo projects", "List projects"]],
    },
  },
  init: {
    coming: false,
    fi: {
      usage: "boggo init [valinnat]",
      description: [
        "Luo Boggo Cloudiin uuden projektin tästä kansiosta ja yhdistää kansion siihen. Komento tunnistaa",
        "sovelluksen (esim. Next.js tai Dockerfile) ja kysyy nimen, käytön ja koon. Voit myös valita",
        "olemassa olevan projektin. Sen jälkeen julkaise komennolla boggo push --prod.",
      ],
      options: [
        ["--name <nimi>", "Projektin nimi (osoite <nimi>.boggo.app)"],
        ["--use verkkosivu|rajapinta", "Mitä sovellus tekee"],
        ["--size perus|iso", "Koko (oletus perus)"],
        ["--org <tunniste>", "Organisaatio, jos kuulut useampaan"],
        ["--yes", "Älä kysy mitään (oletukset)"],
      ],
      examples: [
        ["boggo init", "Luo projekti ohjatusti"],
        ["boggo init --name kauppa --yes", "Luo projekti kauppa kysymättä"],
      ],
    },
    en: {
      usage: "boggo init [options]",
      description: [
        "Creates a new Boggo Cloud project from this folder and links the folder to it. The command",
        "detects the app (e.g. Next.js or a Dockerfile) and asks for the name, use and size. You can",
        "also pick an existing project. Then deploy with boggo push --prod.",
      ],
      options: [
        ["--name <name>", "Project name (address <name>.boggo.app)"],
        ["--use site|api", "What the app does"],
        ["--size basic|large", "Size (default basic)"],
        ["--org <slug>", "Organization, if you belong to several"],
        ["--yes", "Don't ask anything (defaults)"],
      ],
      examples: [
        ["boggo init", "Create a project step by step"],
        ["boggo init --name shop --yes", "Create the project shop without questions"],
      ],
    },
  },
  link: {
    coming: false,
    fi: {
      usage: "boggo link [valinnat]",
      description: [
        "Yhdistää nykyisen kansion Boggo Cloudin projektiin. Valitset organisaation ja projektin",
        "listalta. Tieto tallennetaan kansioon .boggo, joka lisätään tiedostoon .gitignore.",
      ],
      options: [
        ["--project <nimi>", "Projekti ilman valintaa listalta"],
        ["--org <tunniste>", "Organisaatio, jos kuulut useampaan"],
      ],
      examples: [
        ["boggo link", "Valitse projekti listalta"],
        ["boggo link --project kauppa", "Yhdistä projektiin kauppa"],
      ],
    },
    en: {
      usage: "boggo link [options]",
      description: [
        "Links the current folder to a Boggo Cloud project. You pick the organization and project",
        "from a list. The link is saved in the folder .boggo, which is added to .gitignore.",
      ],
      options: [
        ["--project <name>", "Project, without picking from a list"],
        ["--org <slug>", "Organization, if you belong to several"],
      ],
      examples: [
        ["boggo link", "Pick a project from a list"],
        ["boggo link --project shop", "Link to the project shop"],
      ],
    },
  },
  push: {
    coming: false,
    fi: {
      usage: "boggo push [valinnat]",
      description: [
        "Paketoi nykyisen kansion ja rakentaa sen Boggo Cloudissa julkaisematta, joten näet ennen",
        "tuotantoa, onnistuuko rakennus. Valinnalla --prod julkaisu menee tuotantoon. Jos kansiota",
        "ei ole yhdistetty projektiin, komento aloittaa ensin boggo initin.",
        "Mukaan eivät tule .git, node_modules, .env-tiedostot eivätkä .gitignoren tiedostot.",
        "Enimmäiskoko on 100 Mt pakattuna.",
      ],
      options: [
        ["--prod", "Julkaise tuotantoon rakennuksen jälkeen"],
        ["--project <nimi>", "Projekti ilman yhdistettyä kansiota (boggo link)"],
      ],
      examples: [
        ["boggo push", "Rakenna ja tarkista"],
        ["boggo push --prod", "Rakenna ja julkaise tuotantoon"],
      ],
    },
    en: {
      usage: "boggo push [options]",
      description: [
        "Packs the current folder and builds it in Boggo Cloud without deploying, so you see before",
        "production whether the build succeeds. With --prod the deployment goes to production. If the",
        "folder isn't linked to a project, the command runs boggo init first.",
        "The upload leaves out .git, node_modules, .env files and files in .gitignore.",
        "The maximum size is 100 MB packed.",
      ],
      options: [
        ["--prod", "Deploy to production after the build"],
        ["--project <name>", "Project, without a linked folder (boggo link)"],
      ],
      examples: [
        ["boggo push", "Build and check"],
        ["boggo push --prod", "Build and deploy to production"],
      ],
    },
  },
  env: {
    coming: true,
    fi: {
      usage: "boggo env <pull|ls> [valinnat]",
      description: [
        "env pull hakee projektin ympäristömuuttujat tiedostoon (oletus .env.local). Salaisten",
        "muuttujien arvot jäävät palvelimelle; ne tulevat tiedostoon vain nimenä kommenttina.",
        "env ls listaa muuttujien nimet ja tyypit.",
      ],
      options: [["--project <nimi>", "Projekti ilman yhdistettyä kansiota (boggo link)"]],
      examples: [
        ["boggo env pull", "Hae muuttujat tiedostoon .env.local"],
        ["boggo env pull .env", "Hae muuttujat tiedostoon .env"],
        ["boggo env ls", "Listaa muuttujat"],
      ],
    },
    en: {
      usage: "boggo env <pull|ls> [options]",
      description: [
        "env pull downloads the project's environment variables to a file (default .env.local).",
        "Secret values stay on the server; they appear in the file only as a commented name.",
        "env ls lists the variables' names and types.",
      ],
      options: [["--project <name>", "Project, without a linked folder (boggo link)"]],
      examples: [
        ["boggo env pull", "Download variables to .env.local"],
        ["boggo env pull .env", "Download variables to .env"],
        ["boggo env ls", "List variables"],
      ],
    },
  },
  logs: {
    coming: true,
    fi: {
      usage: "boggo logs [valinnat]",
      description: ["Näyttää sovelluksen tulosteen, kuten portaalin Lokit → Sovellus."],
      options: [
        ["--follow", "Seuraa uusia rivejä"],
        ["--requests", "Näytä pyyntöloki sovelluksen tulosteen sijaan"],
        ["--since <aika>", "Aikaväli, esim. 1h tai 24h"],
        ["--project <nimi>", "Projekti ilman yhdistettyä kansiota (boggo link)"],
      ],
      examples: [
        ["boggo logs", "Viimeisimmät rivit"],
        ["boggo logs --follow", "Seuraa lokia"],
      ],
    },
    en: {
      usage: "boggo logs [options]",
      description: ["Shows the app's output, like Logs → App in the portal."],
      options: [
        ["--follow", "Follow new lines"],
        ["--requests", "Show the request log instead of the app's output"],
        ["--since <time>", "Time range, e.g. 1h or 24h"],
        ["--project <name>", "Project, without a linked folder (boggo link)"],
      ],
      examples: [
        ["boggo logs", "Latest lines"],
        ["boggo logs --follow", "Follow the log"],
      ],
    },
  },
  open: {
    coming: false,
    fi: {
      usage: "boggo open [valinnat]",
      description: ["Avaa projektin julkisen osoitteen selaimessa."],
      options: [["--portal", "Avaa projektin sivu Boggo Cloudin portaalissa"]],
      examples: [
        ["boggo open", "Avaa sivusto"],
        ["boggo open --portal", "Avaa projekti portaalissa"],
      ],
    },
    en: {
      usage: "boggo open [options]",
      description: ["Opens the project's public address in your browser."],
      options: [["--portal", "Open the project's page in the Boggo Cloud portal"]],
      examples: [
        ["boggo open", "Open the site"],
        ["boggo open --portal", "Open the project in the portal"],
      ],
    },
  },
  help: {
    coming: false,
    fi: {
      usage: "boggo help [komento]",
      description: ["Näyttää kaikki komennot tai yhden komennon tarkemman ohjeen."],
      options: [],
      examples: [
        ["boggo help", "Kaikki komennot"],
        ["boggo help push", "Komennon push ohje"],
      ],
    },
    en: {
      usage: "boggo help [command]",
      description: ["Shows all commands, or detailed help for one command."],
      options: [],
      examples: [
        ["boggo help", "All commands"],
        ["boggo help push", "Help for push"],
      ],
    },
  },
  config: {
    coming: false,
    fi: {
      usage: "boggo config kieli [fi|en]",
      description: [
        "Vaihtaa kielen. Ilman arvoa komento kysyy kielen. Valinta tallennetaan tiedostoon",
        "~/.boggo/config.json. Yhdelle komennolle kielen voi valita valinnalla --lang, ja",
        "ympäristömuuttuja BOGGO_LANG ohittaa tallennetun kielen.",
      ],
      options: [],
      examples: [
        ["boggo config kieli", "Kysy kieli"],
        ["boggo config kieli en", "Vaihda englanniksi"],
        ["boggo help --lang en", "Ohje kerran englanniksi"],
      ],
    },
    en: {
      usage: "boggo config language [fi|en]",
      description: [
        "Changes the language. Without a value the command asks for it. The choice is saved in",
        "~/.boggo/config.json. Use --lang to pick a language for one command; the environment",
        "variable BOGGO_LANG overrides the saved language.",
      ],
      options: [],
      examples: [
        ["boggo config language", "Ask for the language"],
        ["boggo config language fi", "Switch to Finnish"],
        ["boggo help --lang fi", "Help in Finnish once"],
      ],
    },
  },
};

// Asetuksen kieli nimet: suomeksi kieli, englanniksi language (kumpikin toimii kummallakin kielellä).
export const LANGUAGE_SETTING_NAMES = ["kieli", "language"];
