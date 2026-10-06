import { requestUrl } from "obsidian";

/**
 * Looks up selected text with Google Translate, which detects the language: English text gets Google's
 * dictionary definitions, or else the first answer from Wiktionary or the Free Dictionary API; anything
 * else is translated into English.
 */

export interface WordSense {
  definition: string;
  example?: string;
}

export interface WordMeaning {
  partOfSpeech: string;
  senses: WordSense[];
}

export type LookupResult =
  | { kind: "definition"; text: string; phonetic: string; meanings: WordMeaning[] }
  | { kind: "translation"; text: string; translation: string; sourceLanguage: string }
  | { kind: "not-found"; text: string };

/** Fetches JSON; resolves `null` for a "not found" response instead of throwing. */
export type JsonFetcher = (url: string) => Promise<unknown>;

const MAX_LOOKUP_LENGTH = 500;
const SENSES_PER_MEANING = 3;
const REQUEST_TIMEOUT_MS = 8000;

export const fetchJson: JsonFetcher = async (url) => {
  const host = new URL(url).host;
  let timer = 0;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(`${host} did not answer in time`)), REQUEST_TIMEOUT_MS);
  });
  // Wikimedia asks API clients to identify themselves.
  const headers = host.endsWith("wiktionary.org") ? { "Api-User-Agent": "OmniBookReaderMod (personal Obsidian plugin)" } : undefined;
  const response = await Promise.race([requestUrl({ url, throw: false, ...(headers ? { headers } : {}) }), timeout])
    .finally(() => window.clearTimeout(timer));
  if (response.status === 404) return null;
  if (response.status < 200 || response.status >= 300) throw new Error(`${host} answered ${response.status}`);
  return response.json as unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** The English name of a language code ("fr" → "French"), or the code itself. */
export function languageName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Reads Google Translate's `translate_a/single` answer: the translation and the detected source language. */
export function parseGoogleTranslation(data: unknown): { translation: string; sourceLanguage: string } | null {
  if (!Array.isArray(data)) return null;
  const segments: unknown = data[0];
  const translation = Array.isArray(segments)
    ? segments.map((segment: unknown) => (Array.isArray(segment) ? text(segment[0]) : "")).join(" ").replace(/\s+/g, " ").trim()
    : "";
  const sourceLanguage = text(data[2]);
  return sourceLanguage ? { translation, sourceLanguage } : null;
}

/** Reads the dictionary part of a Google Translate answer (`dt=md`): `[[partOfSpeech, [[definition, id, example?], …]], …]` at index 12. */
export function parseGoogleDefinitions(data: unknown): WordMeaning[] | null {
  if (!Array.isArray(data) || !Array.isArray(data[12])) return null;
  const meanings: WordMeaning[] = [];
  for (const group of data[12] as unknown[]) {
    if (!Array.isArray(group) || !Array.isArray(group[1])) continue;
    const senses = (group[1] as unknown[])
      .filter((item): item is unknown[] => Array.isArray(item))
      .map((item): WordSense => {
        const example = text(item[2]);
        return { definition: text(item[0]), ...(example ? { example } : {}) };
      })
      .filter((sense) => sense.definition)
      .slice(0, SENSES_PER_MEANING);
    if (senses.length) meanings.push({ partOfSpeech: text(group[0]), senses });
  }
  return meanings.length ? meanings : null;
}

/** Plain text from the small HTML snippets Wiktionary uses for definitions and examples. */
export function htmlToText(html: string): string {
  const text = typeof DOMParser === "function"
    ? new DOMParser().parseFromString(html, "text/html").body.textContent ?? ""
    : html.replace(/<[^>]*>/g, "");
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Reads Wiktionary's REST definition answer (`/api/rest_v1/page/definition/<word>`):
 * `{ en: [{ partOfSpeech, definitions: [{ definition: html, examples?: html[] }] }], … }`.
 */
export function parseWiktionaryDefinitions(data: unknown): { phonetic: string; meanings: WordMeaning[] } | null {
  if (!isRecord(data) || !Array.isArray(data.en)) return null;
  const meanings: WordMeaning[] = [];
  for (const group of data.en) {
    if (!isRecord(group) || !Array.isArray(group.definitions)) continue;
    const senses = group.definitions
      .filter(isRecord)
      .map((item): WordSense => {
        const example = Array.isArray(item.examples) && typeof item.examples[0] === "string" ? htmlToText(item.examples[0]) : "";
        return { definition: htmlToText(text(item.definition)), ...(example ? { example } : {}) };
      })
      .filter((sense) => sense.definition)
      .slice(0, SENSES_PER_MEANING);
    if (senses.length) meanings.push({ partOfSpeech: text(group.partOfSpeech).toLowerCase(), senses });
  }
  return meanings.length ? { phonetic: "", meanings } : null;
}

type DictionaryEntry = { phonetic: string; meanings: WordMeaning[] };

/**
 * Asks every dictionary at once and takes the first entry found, so one slow or unreachable service
 * does not hold up the lookup. Resolves `null` when a service answered that it has no entry; rejects
 * only when none of them answered at all.
 */
function firstEntry(attempts: Array<Promise<DictionaryEntry | null>>): Promise<DictionaryEntry | null> {
  return new Promise((resolve, reject) => {
    let remaining = attempts.length;
    let answered = false;
    let lastError: unknown = null;
    let done = false;
    for (const attempt of attempts) {
      attempt.then((entry) => {
        answered = true;
        if (entry && !done) {
          done = true;
          resolve(entry);
        }
      }, (error: unknown) => {
        lastError = error;
      }).finally(() => {
        remaining -= 1;
        if (remaining || done) return;
        done = true;
        if (answered) resolve(null);
        else reject(lastError instanceof Error ? lastError : new Error("No dictionary answered"));
      });
    }
  });
}

/** Reads the Free Dictionary API answer into parts of speech with a few senses each. */
export function parseDictionaryEntries(data: unknown): { phonetic: string; meanings: WordMeaning[] } | null {
  if (!Array.isArray(data)) return null;
  let phonetic = "";
  const meanings: WordMeaning[] = [];
  for (const entry of data) {
    if (!isRecord(entry)) continue;
    phonetic ||= text(entry.phonetic)
      || (Array.isArray(entry.phonetics)
        ? entry.phonetics.map((item: unknown) => (isRecord(item) ? text(item.text) : "")).find(Boolean) ?? ""
        : "");
    if (!Array.isArray(entry.meanings)) continue;
    for (const meaning of entry.meanings) {
      if (!isRecord(meaning) || !Array.isArray(meaning.definitions)) continue;
      const partOfSpeech = text(meaning.partOfSpeech);
      const senses = meaning.definitions
        .filter(isRecord)
        .map((item): WordSense => {
          const example = text(item.example);
          return { definition: text(item.definition), ...(example ? { example } : {}) };
        })
        .filter((sense) => sense.definition);
      if (!senses.length) continue;
      const existing = meanings.find((item) => item.partOfSpeech === partOfSpeech);
      if (existing) existing.senses.push(...senses);
      else meanings.push({ partOfSpeech, senses });
    }
  }
  for (const meaning of meanings) meaning.senses = meaning.senses.slice(0, SENSES_PER_MEANING);
  return meanings.length ? { phonetic, meanings } : null;
}

/** Defines English text or translates anything else into English. */
export async function lookUpSelection(selection: string, fetcher: JsonFetcher = fetchJson): Promise<LookupResult> {
  const query = selection.replace(/\s+/g, " ").trim().replace(/^[\p{P}\s]+|[\p{P}\s]+$/gu, "").slice(0, MAX_LOOKUP_LENGTH);
  if (!query) return { kind: "not-found", text: selection.trim() };
  const define = async (googleMeanings: WordMeaning[] | null): Promise<LookupResult> => {
    if (googleMeanings) return { kind: "definition", text: query, phonetic: "", meanings: googleMeanings };
    const word = encodeURIComponent(query.toLowerCase());
    const entry = await firstEntry([
      fetcher(`https://en.wiktionary.org/api/rest_v1/page/definition/${word}`).then(parseWiktionaryDefinitions),
      fetcher(`https://api.dictionaryapi.dev/api/v2/entries/en/${word}`).then(parseDictionaryEntries),
    ]);
    return entry ? { kind: "definition", text: query, ...entry } : { kind: "not-found", text: query };
  };

  let google: unknown;
  try {
    google = await fetcher(
      `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&dt=md&q=${encodeURIComponent(query)}`,
    );
  } catch (error) {
    // Without Google, plain English-looking words can still be defined.
    if (/^[A-Za-z][A-Za-z' -]*$/.test(query)) return define(null);
    throw error;
  }
  const translated = parseGoogleTranslation(google);
  if (!translated) {
    if (/^[A-Za-z][A-Za-z' -]*$/.test(query)) return define(null);
    throw new Error("Could not detect the language of the selection");
  }
  if (translated.sourceLanguage.toLowerCase().startsWith("en")) return define(parseGoogleDefinitions(google));
  return translated.translation
    ? { kind: "translation", text: query, translation: translated.translation, sourceLanguage: translated.sourceLanguage }
    : { kind: "not-found", text: query };
}

/** A one-line version of the result, for copying and for saving as a highlight's note. */
export function lookupSummary(result: LookupResult): string {
  if (result.kind === "translation") return `${result.translation} (from ${languageName(result.sourceLanguage)})`;
  if (result.kind === "not-found") return "";
  return result.meanings
    .map((meaning) => [meaning.partOfSpeech, meaning.senses[0]?.definition ?? ""].filter(Boolean).join(": "))
    .filter(Boolean)
    .join("; ");
}

/** The tag a saved lookup gets on its highlight. */
export function lookupTag(result: LookupResult): string {
  return result.kind === "translation" ? "translation" : "definition";
}
