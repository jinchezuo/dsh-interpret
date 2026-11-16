# Terminology data licenses

This directory contains a generated academic terminology corpus. It is data,
not executable code; the plugin's own source remains MIT.

## Sources

- **Wikipedia glossaries** — terms and definitions extracted from:
  Glossary of artificial intelligence, Glossary of biology, Glossary of
  architecture, Glossary of electrical and electronics engineering, Glossary
  of mathematical jargon, Glossary of probability and statistics, Glossary of
  engineering, Glossary of physics.
  License: CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/).
  The corpus is a derivative of these pages; attribute Wikipedia and keep the
  same license for the derived data.

- **Britfone** — British English (RP/SSB) IPA.
  Source: https://github.com/loveencounterflow/Britfone
  License: MIT, Copyright (c) 2017 Jose Llarena.
  Only pronunciation fields are extracted; the dictionary itself is not
  redistributed.

- **CMU Pronouncing Dictionary (cmudict)** — US ARPAbet.
  Source: https://github.com/cmusphinx/cmudict
  License: BSD-2-Clause, Copyright (C) 1993-2015 Carnegie Mellon University.
  ARPAbet is converted to an approximate IPA string for display; ARPAbet is
  kept for matching.

- **Curated core** — assets/terminology/curated.json and curated-extra.json.
  Created for this project, including Chinese names and common ASR confusions.
  License: project MIT.

## Notes

- Wikipedia/Wiktionary text is CC BY-SA; do not relicense the derived corpus
  as MIT. Keep this notice with redistributed data.
- IPA fields are display/matching aids, not a claim of exhaustive
  lexicographic coverage. Multi-word terms are assembled from word-level
  entries when a phrase entry is unavailable.
- The corpus contains no Wikipedia article prose beyond short definitions used
  for retrieval.
