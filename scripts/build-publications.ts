import { readFile, writeFile } from "node:fs/promises";
import { parse } from "yaml";

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

type PublicationsData = {
  groups: PublicationGroup[];
  notes?: string[];
};

const dataPath = "data/publications.yml";
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

function validate(data: unknown): asserts data is PublicationsData {
  if (!data || typeof data !== "object") {
    throw new Error(`${dataPath} must contain an object`);
  }

  const publications = data as Partial<PublicationsData>;
  if (!Array.isArray(publications.groups)) {
    throw new Error(`${dataPath} must contain a groups array`);
  }

  for (const group of publications.groups) {
    if (!group.name || !Array.isArray(group.items)) {
      throw new Error("Each publication group needs a name and items array");
    }

    for (const item of group.items) {
      if (!item.title || !Array.isArray(item.authors) || item.authors.length === 0) {
        throw new Error(`Publication in "${group.name}" is missing a title or authors`);
      }
    }
  }
}

function renderPublications(data: PublicationsData): string {
  const groups = data.groups
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

  const notes = data.notes?.length
    ? `        <p class="mt-6 text-sm text-muted">${data.notes.map(escapeHtml).join("<br />")}</p>`
    : "";

  return [groups, notes].filter(Boolean).join("\n");
}

function escapedRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function main() {
  const data = parse(await readFile(dataPath, "utf8"));
  validate(data);

  const html = await readFile(htmlPath, "utf8");
  const markerPattern = new RegExp(
    `(${escapedRegExp(startMarker)})[\\s\\S]*?(${escapedRegExp(endMarker)})`,
  );

  if (!markerPattern.test(html)) {
    throw new Error(`Missing ${startMarker} / ${endMarker} markers in ${htmlPath}`);
  }

  const generated = renderPublications(data);
  await writeFile(htmlPath, html.replace(markerPattern, `$1\n${generated}\n        $2`));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
