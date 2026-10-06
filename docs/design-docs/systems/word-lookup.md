# Word lookup

Status: Accepted
Date: 2026-10-06

## Context

The owner wanted to select a word and get a definition if it is English, or a translation if it is not, showing only the result.

## Decision

- **Trigger:** a "Define or translate" button (`book-a` icon) in the selection toolbar. Nothing is shown while the lookup runs; the result opens in a modal when it arrives, and a failure (for example offline) is a short notice. Repeated taps during a lookup are ignored.
- **Services** (`src/word-lookup.ts`, through Obsidian's `requestUrl`, so no CORS limits): Google Translate's public `translate_a/single?client=gtx&sl=auto&tl=en` endpoint translates the selection and reports the detected language; when that is English, the Free Dictionary API (`api.dictionaryapi.dev`, Wiktionary data) supplies the phonetic and up to three senses per part of speech. Google's search page is not used: it is meant for browsers and often answers automated requests with consent or robot checks.
- **Result actions:** the modal text is selectable; **Copy** copies `word: summary`; **Save to book note** highlights the selection (default colour and style) and saves the one-line summary as the highlight's note with a `definition` or `translation` tag, so it is written to the book note like any other highlight. An existing highlight at the same place keeps its note, with the summary appended.
- **Privacy:** only the selected text is sent, only when the button is tapped. The README discloses both services.

## Alternatives considered

- Scraping Google search results: unreliable and against Google's terms.
- An API-key service: needs keys and accounts for a single-user fork.

## Consequences

- The Google endpoint is unofficial and could change; parsing is defensive and a failure shows a notice.
- Detection of very short words can be wrong (a word that exists in several languages); the result then shows a translation instead of a definition.

## Validation

`tests/word-lookup.test.ts` covers definitions, translations, missing entries, undetectable input, summaries and tags, and malformed answers.
