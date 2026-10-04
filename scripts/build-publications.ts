import { readFile, writeFile } from "node:fs/promises";

type LinkIcon = "paper" | "code";

type PublicationLink = {
  label: string;
  icon: LinkIcon;
  url: string;
};

type Author = {
  name: string;
  me?: boolean;
  equalContribution?: boolean;
};

type Publication = {
  title: string;
  titleUrl?: string;
  authors: Author[];
  venue?: {
    name: string;
    details?: string;
  };
  venueText?: string;
  links?: PublicationLink[];
};

type PublicationGroup = {
  name: string;
  items: Publication[];
};

type BibEntry = {
  type: string;
  key: string;
  fields: Record<string, string>;
};

const dataPath = "data/publications.bib";
const myLastName = "Schwan";

const groupNames: Record<string, string> = {
  misc: "Preprints",
  article: "Journal Papers",
  inproceedings: "Conference Papers",
  conference: "Conference Papers",
  phdthesis: "Dissertations",
  mastersthesis: "Dissertations",
};

const thesisTypes: Record<string, string> = {
  phdthesis: "PhD thesis",
  mastersthesis: "Master's thesis",
};

const htmlPath = "docs/index.html";
const startMarker = "<!-- publications:start -->";
const endMarker = "<!-- publications:end -->";

const icons: Record<LinkIcon, string> = {
  paper: tidy`
    <svg class="h-4 w-4" viewBox="0 0 384 512" aria-hidden="true" fill="currentColor">
      <path d="M176 48L64 48c-8.8 0-16 7.2-16 16l0 384c0 8.8 7.2 16 16 16l256 0c8.8 0 16-7.2 16-16l0-240-88 0c-39.8 0-72-32.2-72-72l0-88zM316.1 160L224 67.9 224 136c0 13.3 10.7 24 24 24l68.1 0zM0 64C0 28.7 28.7 0 64 0L197.5 0c17 0 33.3 6.7 45.3 18.7L365.3 141.3c12 12 18.7 28.3 18.7 45.3L384 448c0 35.3-28.7 64-64 64L64 512c-35.3 0-64-28.7-64-64L0 64z"/>
    </svg>
  `,
  code: tidy`
    <svg class="h-4 w-4" viewBox="0 0 576 512" aria-hidden="true" fill="currentColor">
      <path d="M360.8 1.2c-17-4.9-34.7 5-39.6 22l-128 448c-4.9 17 5 34.7 22 39.6s34.7-5 39.6-22l128-448c4.9-17-5-34.7-22-39.6zm64.6 136.1c-12.5 12.5-12.5 32.8 0 45.3l73.4 73.4-73.4 73.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0l96-96c12.5-12.5 12.5-32.8 0-45.3l-96-96c-12.5-12.5-32.8-12.5-45.3 0zm-274.7 0c-12.5-12.5-32.8-12.5-45.3 0l-96 96c-12.5 12.5-12.5 32.8 0 45.3l96 96c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L77.3 256 150.6 182.6c12.5-12.5 12.5-32.8 0-45.3z"/>
    </svg>
  `,
};

function tidy(strings: TemplateStringsArray, ...values: unknown[]): string {
  const raw = strings.reduce((out, str, index) => {
    return `${out}${str}${index < values.length ? String(values[index]) : ""}`;
  }, "");

  const lines = raw.replace(/^\n|\n\s*$/g, "").split("\n");
  const indentation = Math.min(
    ...lines.filter((line) => line.trim()).map((line) => line.match(/^\s*/)?.[0].length ?? 0),
  );

  return lines.map((line) => line.slice(indentation)).join("\n");
}

function indent(value: string, spaces: number): string {
  const prefix = " ".repeat(spaces);
  return value
    .split("\n")
    .map((line) => (line ? `${prefix}${line}` : line))
    .join("\n");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function authorHtml(author: Author): string {
  const name = `${escapeHtml(author.name)}${author.equalContribution ? "*" : ""}`;
  return author.me ? `<span class="font-semibold text-ink">${name}</span>` : name;
}

function authorsHtml(authors: Author[]): string {
  const names = authors.map(authorHtml);
  if (names.length === 1) return `${names[0]}`;
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
}

function parseBibtex(input: string): BibEntry[] {
  const entries: BibEntry[] = [];
  const strings: Record<string, string> = {};
  let pos = 0;

  const error = (message: string) => {
    const line = input.slice(0, pos).split("\n").length;
    return new Error(`${dataPath}:${line}: ${message}`);
  };

  const skipSpace = () => {
    while (pos < input.length && /\s/.test(input[pos])) pos++;
  };

  const expect = (char: string) => {
    skipSpace();
    if (input[pos] !== char) throw error(`expected "${char}"`);
    pos++;
  };

  const readIdentifier = () => {
    skipSpace();
    const match = /[^\s"#%'(),={}]+/y;
    match.lastIndex = pos;
    const name = match.exec(input)?.[0];
    if (!name) throw error("expected an identifier");
    pos += name.length;
    return name;
  };

  // Reads up to the closing delimiter at brace depth 0; pos must be just past the opening delimiter.
  const readDelimited = (close: string) => {
    const start = pos;
    let depth = 0;
    for (; pos < input.length; pos++) {
      const char = input[pos];
      if (char === "\\") pos++;
      else if (char === "{") depth++;
      else if (char === close && depth === 0) return input.slice(start, pos++);
      else if (char === "}") depth--;
    }
    throw error(`missing closing "${close}"`);
  };

  const readValue = () => {
    let value = "";
    for (;;) {
      skipSpace();
      const char = input[pos];
      if (char === "{" || char === '"') {
        pos++;
        value += readDelimited(char === "{" ? "}" : '"');
      } else {
        const name = readIdentifier();
        const resolved = /^\d+$/.test(name) ? name : strings[name.toLowerCase()];
        if (resolved === undefined) throw error(`undefined @string "${name}"`);
        value += resolved;
      }
      skipSpace();
      if (input[pos] !== "#") return value.replace(/\s+/g, " ").trim();
      pos++;
    }
  };

  while (pos < input.length) {
    const char = input[pos];
    if (char === "%") {
      pos = input.indexOf("\n", pos);
      if (pos === -1) break;
      continue;
    }
    if (char !== "@") {
      pos++;
      continue;
    }

    pos++;
    const type = readIdentifier().toLowerCase();
    skipSpace();
    const open = input[pos];
    if (open !== "{" && open !== "(") throw error(`expected "{" after @${type}`);
    pos++;
    const close = open === "{" ? "}" : ")";

    if (type === "comment" || type === "preamble") {
      readDelimited(close);
    } else if (type === "string") {
      const name = readIdentifier().toLowerCase();
      expect("=");
      strings[name] = readValue();
      expect(close);
    } else {
      const key = readIdentifier();
      const fields: Record<string, string> = {};
      for (;;) {
        skipSpace();
        if (input[pos] === ",") pos++;
        skipSpace();
        if (input[pos] === close) break;
        if (pos >= input.length) throw error(`unterminated entry "${key}"`);
        const name = readIdentifier().toLowerCase();
        expect("=");
        fields[name] = readValue();
      }
      pos++;
      entries.push({ type, key, fields });
    }
  }

  return entries;
}

const accents: Record<string, string> = {
  "`": "̀",
  "'": "́",
  "^": "̂",
  "~": "̃",
  "=": "̄",
  ".": "̇",
  '"': "̈",
  u: "̆",
  v: "̌",
  H: "̋",
  r: "̊",
  c: "̧",
  k: "̨",
  d: "̣",
};

const symbols: Record<string, string> = {
  ss: "ß",
  ae: "æ",
  AE: "Æ",
  oe: "œ",
  OE: "Œ",
  aa: "å",
  AA: "Å",
  o: "ø",
  O: "Ø",
  l: "ł",
  L: "Ł",
  i: "i",
  j: "j",
};

function latexToText(value: string): string {
  return value
    .replace(/\\(ss|ae|AE|oe|OE|aa|AA|o|O|l|L|i|j)(?![A-Za-z])(?:\{\}|\s+)?/g, (_, name: string) => symbols[name])
    .replace(
      /\\([`'^~=."])\s*(?:\{([^{}]*)\}|([^\s{}\\]))|\\([uvHrckd])(?:\s*\{([^{}]*)\}|\s+([^\s{}\\]))/g,
      (match, symbol?: string, braced1?: string, bare1?: string, letter?: string, braced2?: string, bare2?: string) => {
        const base = braced1 ?? bare1 ?? braced2 ?? bare2 ?? "";
        const accent = accents[symbol ?? letter ?? ""];
        return base ? `${base}${accent}` : match;
      },
    )
    .replace(/\\([&%$#_])/g, "$1")
    .replace(/\\[A-Za-z]+\s*/g, "")
    .replace(/---/g, "—")
    .replace(/--/g, "–")
    .replace(/~/g, " ")
    .replace(/[{}]/g, "")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim();
}

// Splits on a sticky separator pattern, ignoring matches inside braces.
function splitTopLevel(value: string, separator: RegExp): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === "{") depth++;
    else if (value[i] === "}") depth--;
    else if (depth === 0) {
      separator.lastIndex = i;
      const match = separator.exec(value);
      if (match?.[0]) {
        parts.push(value.slice(start, i));
        i += match[0].length - 1;
        start = i + 1;
      }
    }
  }
  parts.push(value.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

function initials(given: string): string {
  return splitTopLevel(given, /\s+/y)
    .map((word) =>
      latexToText(word)
        .split("-")
        .map((part) => `${Array.from(part)[0] ?? ""}.`)
        .join("-"),
    )
    .join(" ");
}

// Formats "Last, First" or "First von Last" as "F. von Last".
function parseName(raw: string): { name: string; lastName: string } {
  const parts = splitTopLevel(raw, /,/y);
  let given = "";
  let last: string;

  if (parts.length > 1) {
    last = parts[0];
    given = parts.at(-1) ?? "";
  } else {
    const words = splitTopLevel(raw, /\s+/y);
    let split = words.findIndex((word, index) => index > 0 && index < words.length - 1 && /^[a-z]/.test(word));
    if (split === -1) split = words.length - 1;
    given = words.slice(0, split).join(" ");
    last = words.slice(split).join(" ");
  }

  const lastName = latexToText(last);
  return { name: given ? `${initials(given)} ${lastName}` : lastName, lastName };
}

function joinDetails(parts: (string | undefined)[]): string | undefined {
  return parts.filter(Boolean).join(", ") || undefined;
}

function toPublication(entry: BibEntry): Publication {
  const raw = entry.fields;
  const text = (name: string) => (raw[name] ? latexToText(raw[name]) : undefined);
  const title = text("title");

  if (!title || !raw.author) {
    throw new Error(`${dataPath}: entry "${entry.key}" is missing a title or author`);
  }

  const equal = (text("equal") ?? "").split(",").map((name) => name.trim()).filter(Boolean);
  const authors = splitTopLevel(raw.author, /\s+and\s+/iy).map((author): Author => {
    const { name, lastName } = parseName(author);
    return {
      name,
      me: lastName === myLastName || undefined,
      equalContribution: equal.includes(lastName) || undefined,
    };
  });

  for (const name of equal) {
    if (!authors.some((author) => author.name.endsWith(` ${name}`) || author.name === name)) {
      throw new Error(`${dataPath}: entry "${entry.key}" lists "${name}" in equal, but no author has that last name`);
    }
  }

  const year = text("year");
  const pages = raw.pages?.replace(/\s*-+\s*/g, "-");
  const volume = raw.volume && `vol. ${raw.volume}`;
  const number = raw.number && `no. ${raw.number}`;
  const pp = pages && `pp. ${pages}`;

  let venueName: string | undefined;
  let details: string | undefined;
  let venueText: string | undefined;

  switch (entry.type) {
    case "article":
      venueName = text("journal");
      details = joinDetails([volume, number, pp, year]);
      break;
    case "inproceedings":
    case "conference":
      venueName = text("booktitle");
      details = joinDetails([volume, year, pp]);
      break;
    case "misc":
      venueText = joinDetails([text("howpublished") ?? "Preprint", year]);
      break;
    case "phdthesis":
    case "mastersthesis":
      venueText = joinDetails([text("type") ?? thesisTypes[entry.type], text("school"), year]);
      break;
    default:
      venueName = text("journal") ?? text("booktitle") ?? text("publisher");
      details = year;
  }

  const doi = raw.doi?.replace(/^https?:\/\/(dx\.)?doi\.org\//, "");
  const doiUrl = doi && `https://doi.org/${doi}`;
  const paperUrl = raw.pdf ?? doiUrl;
  const links: PublicationLink[] = [];
  if (paperUrl) links.push({ label: "Paper", icon: "paper", url: paperUrl });
  if (raw.code) links.push({ label: "Code", icon: "code", url: raw.code });

  return {
    title,
    titleUrl: doiUrl ?? raw.url,
    authors,
    venue: venueName ? { name: venueName, details } : undefined,
    venueText: venueName ? undefined : (venueText ?? details),
    links,
  };
}

function groupPublications(entries: BibEntry[]): PublicationGroup[] {
  const groups = new Map<string, Publication[]>();

  for (const entry of entries) {
    const name = entry.fields.group ? latexToText(entry.fields.group) : groupNames[entry.type];
    if (!name) {
      throw new Error(`${dataPath}: entry "${entry.key}" has type @${entry.type}; add a group field to place it`);
    }
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name)?.push(toPublication(entry));
  }

  return Array.from(groups, ([name, items]) => ({ name, items }));
}

function renderPublications(publicationGroups: PublicationGroup[]): string {
  return publicationGroups
    .map((group, groupIndex) => {
      const groupMargin = groupIndex === 0 ? "mt-6" : "mt-10";
      const lines = [
        `        <h3 class="${groupMargin} text-lg font-semibold tracking-normal text-ink">${escapeHtml(group.name)}</h3>`,
        '        <ol class="mt-4 space-y-7">',
      ];

      for (const publication of group.items) {
        const title = publication.titleUrl
          ? `<a href="${escapeHtml(publication.titleUrl)}" target="_blank" rel="noopener">${escapeHtml(publication.title)}</a>`
          : escapeHtml(publication.title);

        const venue = publication.venueText
          ? escapeHtml(publication.venueText)
          : publication.venue
            ? `<span class="italic">${escapeHtml(publication.venue.name)}</span>${
                publication.venue.details ? `, ${escapeHtml(publication.venue.details)}` : "."
              }`
            : "";

        lines.push(
          "          <li>",
          '            <p class="font-medium text-ink">',
          `              ${title}`,
          "            </p>",
          '            <p class="mt-0.5 leading-7 text-slate-700">',
          `              ${authorsHtml(publication.authors)}`,
          "            </p>",
        );

        if (venue) {
          lines.push(
            '            <p class="mt-0.5 leading-7 text-slate-700">',
            `              ${venue}`,
            "            </p>",
          );
        }

        if (publication.links?.length) {
          lines.push('            <p class="mt-1 flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted">');
          for (const link of publication.links) {
            lines.push(
              `              <a class="inline-flex items-center gap-1.5" href="${escapeHtml(link.url)}" target="_blank" rel="noopener">`,
              indent(icons[link.icon], 16),
              `                ${escapeHtml(link.label)}`,
              "              </a>",
            );
          }
          lines.push("            </p>");
        }

        lines.push("          </li>");
      }

      lines.push("        </ol>");
      return lines.join("\n");
    })
    .join("\n\n");
}

function escapedRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function main() {
  const groups = groupPublications(parseBibtex(await readFile(dataPath, "utf8")));

  const html = await readFile(htmlPath, "utf8");
  const markerPattern = new RegExp(
    `(${escapedRegExp(startMarker)})[\\s\\S]*?(${escapedRegExp(endMarker)})`,
  );

  if (!markerPattern.test(html)) {
    throw new Error(`Missing ${startMarker} / ${endMarker} markers in ${htmlPath}`);
  }

  const generated = renderPublications(groups);
  await writeFile(htmlPath, html.replace(markerPattern, `$1\n${generated}\n        $2`));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
