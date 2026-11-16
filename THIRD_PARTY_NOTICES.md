# Third-party notices

## dsh-asr-plugin capture helper

The optional system-audio capture adapter locates and spawns the signed helper
shipped by @huliux/dsh-asr-plugin (Apache-2.0). Its upstream native capture
source is the Bitbook/clerki project, BSD-2-Clause. This repository does not
redistribute the helper; it is discovered at runtime from the installed plugin.
If that plugin is absent, system audio is unavailable and only the microphone
path runs.

## Speech models

- Parakeet TDT 0.6B v2 (int8, sherpa-onnx format) — downloaded by the user from
  Hugging Face (csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8) and
  governed by its upstream license.
- SenseVoice Small (int8) — provided by DeepSeek Harness speech-to-text; model
  weights are downloaded by DSH and are not bundled here.
- Silero VAD — not required by the current energy VAD implementation.

Model weights are never committed to this repository or packaged into the npm
bundle.

## Terminology data

The generated corpus in assets/terminology is derived from Wikipedia glossaries
(CC BY-SA 4.0), Britfone British IPA (MIT, Copyright (c) 2017 Jose Llarena), and
the CMU Pronouncing Dictionary (BSD-2-Clause, Copyright (C) 1993-2015 Carnegie
Mellon University), plus a project-curated core. See
assets/terminology/DATA-LICENSES.md for sources, links, and attribution. The
data is CC BY-SA 4.0 where derived from Wikipedia; the plugin code is MIT.
Model and dictionary source files are not redistributed.
