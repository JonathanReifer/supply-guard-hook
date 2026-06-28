// Known malicious packages
// Sources: OSV.dev, Phylum, Socket.dev, PyPI security advisories
// Update this file as new incidents are confirmed.
import type { Ecosystem, ThreatEntry } from "../types.ts";

export const VERSION = "1.0.0";

export const KNOWN_MALICIOUS: Partial<Record<Ecosystem, ThreatEntry[]>> = {
  pip: [
    { name: "coloama", reason: "Typosquat of colorama — credential harvester (2022)" },
    { name: "python-dateutil2", reason: "Backdoor injected into legitimate utility (2023)" },
    { name: "ctx", reason: "Account takeover — malicious version published May 2022" },
    { name: "phpass", reason: "Typosquat of passlib — credential stealer" },
    { name: "acqusition", reason: "Typosquat of acquisition — data exfiltration" },
    { name: "setup-tools", reason: "Typosquat of setuptools — installs backdoor" },
    { name: "loguru-dev", reason: "Typosquat of loguru — exfiltrates env vars" },
    { name: "aiohttp-requests", reason: "Malicious package mimicking aiohttp (2023)" },
    { name: "pyg-lib", reason: "Dependency confusion attack vector (2022)" },
    { name: "noblesse", reason: "Discord token stealer, browser credential harvester (2021)" },
    { name: "discord-selfbot-v14", reason: "Token logger, remote access trojan" },
    { name: "importantpackage", reason: "Crypto miner + data exfiltration (2022)" },
    { name: "python3-dateutil", reason: "Typosquat of python-dateutil with backdoor" },
    { name: "browserdivs", reason: "Browser credential harvester" },
    { name: "pycryptodome3", reason: "Typosquat of pycryptodome — backdoor" },
    { name: "httpx-async", reason: "Typosquat of httpx — exfiltrates secrets" },
    { name: "ssh-import-id2", reason: "Typosquat of ssh-import-id — SSH key theft" },
    { name: "requets", reason: "Typosquat of requests — credential harvester (transposed 's'/'t')" },
    { name: "aws-sdk", reason: "Wrong ecosystem — for pip this is a malicious package" },
  ],
  npm: [
    { name: "event-source-pollyfill", reason: "Typosquat of event-source-polyfill — crypto miner (2021)" },
    { name: "ua-parser-js", reason: "Account compromise — malicious versions 0.7.29, 0.8.0, 1.0.0 (2021)", cve: "CVE-2021-41265" },
    { name: "coa", reason: "Account compromise — malicious versions injected (2021)" },
    { name: "rc", reason: "Account compromise — malicious versions injected (2021)" },
    { name: "node-ipc", reason: "Protestware — destructive payload targeting Russian/Belarusian IPs (2022)", cve: "CVE-2022-23812" },
    { name: "colors", reason: "Protestware — infinite loop injected by maintainer (2022)" },
    { name: "faker", reason: "Protestware — broken by maintainer (2022), use @faker-js/faker" },
    { name: "lodash-dev", reason: "Typosquat of lodash — credential harvester" },
    { name: "express-validator-plus", reason: "Typosquat of express-validator — exfiltrates process.env" },
    { name: "discord.io", reason: "Compromised — malicious update pushed (2022)" },
    { name: "simple-get2", reason: "Typosquat of simple-get — data exfiltration" },
    { name: "axios-proxy", reason: "Typosquat of axios — exfiltrates HTTP traffic" },
    { name: "@types/react18", reason: "Typosquat of @types/react — malicious postinstall" },
    { name: "crossenv", reason: "Typosquat of cross-env — env var exfiltration (2017)" },
    { name: "babelcli", reason: "Typosquat of babel-cli — crypto miner" },
    { name: "d3.js", reason: "Typosquat of d3 — malicious postinstall" },
    { name: "electorn", reason: "Typosquat of electron — backdoor" },
    { name: "mongose", reason: "Typosquat of mongoose — data exfiltration" },
    { name: "socketio", reason: "Typosquat of socket.io — exfiltrates secrets" },
    { name: "proxy-srv", reason: "Crypto miner bundled in postinstall" },
    { name: "mariadb-connection", reason: "Typosquat of mysql — credential stealer" },
    { name: "lodahs", reason: "Typosquat of lodash — env var exfiltration (transposed 's'/'h')" },
  ],
};
