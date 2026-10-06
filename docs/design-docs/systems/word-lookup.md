# Word lookup

Status: Accepted
Date: 2026-10-06

## Context

The owner wanted to select a word and get a definition if it is English, or a translation if it is not, showing only the result.

## Decision

- **Trigger:** a "Define or translate" button (`book-a` icon) in the selection toolbar. Nothing is shown while the lookup runs; the result opens in a panel inside the reader (not an Obsidian modal: focus mode's full-screen layer, z-index 1000, sits above Obsidian's modals and notices, which made 1.1.15's modal invisible there). Failures show in the reader's own status line for 6 seconds. A tap during a lookup says so; a lookup slower than 1.5 seconds shows a brief "Looking up…"; each request gives up after 12 seconds. Android can clear the selection as the toolbar is tapped (dismissing its own Copy/Share bar), so the selection made in the last 10 seconds is used when the current one is gone; with none, the status line asks for a selection.
- **Services** (`src/word-lookup.ts`, through Obsidian's `requestUrl`, so no CORS limits): Google Translate's public `translate_a/single?client=gtx&sl=auto&tl=en&dt=t&dt=md` endpoint translates the selection, reports the detected language and, for English, returns Google's dictionary definitions (index 12). Up to three senses per part of speech are shown. When Google has no definitions, Wiktionary's REST API (`en.wiktionary.org/api/rest_v1/page/definition/<word>`, HTML stripped to text, sent with an `Api-User-Agent` header) and the Free Dictionary API (`api.dictionaryapi.dev`) are asked at once and the first entry wins, so one slow or unreachable service cannot stall the lookup (1.1.21 timed out on a tablet that could not reach the Free Dictionary API). Plain English-looking words go to the dictionaries too if Google does not answer at all. Each request times out after 8 seconds, and errors name the service's host. Google's search page is not used: it is meant for browsers and often answers automated requests with consent or robot checks.
- **Result actions:** the panel text is selectable; **Copy** copies `word: summary`; **Save to book note** highlights the selection (default colour and style) and saves the one-line summary as the highlight's note with a `definition` or `translation` tag, and marks it `lookup: true` (a stored, synced flag), so its book-note line is `> > - <word> *-- <result> (<chapter>, [p. <page>](<link>))*`, without `#quote` or tags. An existing highlight at the same place keeps its note, with the summary appended.
- **Privacy:** only the selected text is sent, only when the button is tapped. The README discloses both services.

## Alternatives considered

- Scraping Google search results: unreliable and against Google's terms.
- An API-key service: needs keys and accounts for a single-user fork.

## Consequences

- The Google endpoint is unofficial and could change; parsing is defensive and a failure shows a notice.
- Detection of very short words can be wrong (a word that exists in several languages); the result then shows a translation instead of a definition.

## Validation

`tests/word-lookup.test.ts` covers definitions, translations, missing entries, undetectable input, summaries and tags, and malformed answers.
