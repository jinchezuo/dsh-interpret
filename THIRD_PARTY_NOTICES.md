# Third-party notices

## Bundled system-audio capture helper

This plugin redistributes the signed ScreenCaptureKit helper from
@huliux/dsh-asr-plugin under the Apache License 2.0. The helper is stored in
assets/system-audio/recording-helper and is used only for local system-audio
capture.

Upstream native capture source: Bitbook/clerki (BSD-2-Clause).
Upstream plugin: @huliux/dsh-asr-plugin (Apache-2.0).

The Apache-2.0 license text is included at assets/system-audio/LICENSE. Upstream third-party license texts (including BSD-2-Clause-Bitbook and ONNX Runtime notices) are included under assets/system-audio/third_party.

## Speech models

- Parakeet TDT 0.6B v2 (int8, sherpa-onnx format) — downloaded on first use
  from Hugging Face (csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8) and
  governed by its upstream license.
- Streaming Zipformer English 2023-06-26 — downloaded on first use from
  csukuangfj/sherpa-onnx-streaming-zipformer-en-2023-06-26.
- Silero VAD model — bundled at assets/models/silero_vad.onnx; Silero VAD is
  MIT-licensed (snakers4/silero-vad).
- SenseVoice Small — optional, provided by DeepSeek Harness speech-to-text;
  weights are not bundled.

Model weights other than the small Silero VAD file are not committed to this
repository or packaged into the npm bundle.

## Native runtime

sherpa-onnx-node and its platform-specific sherpa-onnx native packages are
installed as npm dependencies and are Apache-2.0 licensed.

## Document rendering

The handout reader uses the Python runtime bundled with DeepSeek Harness
(python-docx, openpyxl, python-pptx, Pillow). Those packages retain their
upstream licenses. .doc conversion on macOS uses the system textutil command.

## Terminology data

The generated corpus in assets/terminology is derived from Wikipedia glossaries
(CC BY-SA 4.0), Britfone British IPA (MIT, Copyright (c) 2017 Jose Llarena), and
the CMU Pronouncing Dictionary (BSD-2-Clause, Copyright (C) 1993-2015 Carnegie
Mellon University), plus a project-curated core. See
assets/terminology/DATA-LICENSES.md for sources, links, and attribution.
