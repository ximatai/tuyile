# Third-party notices

Tuyile's original contributions are licensed under Apache-2.0; see [LICENSE](LICENSE) and [NOTICE](NOTICE). Third-party portions retain their original licenses. This document identifies important incorporated material and dependencies; it does not replace the notices shipped with installed packages or native libraries.

## Adapted code and design

Tuyile selectively adapts engineering-blue visual tokens, sidebar layout conventions, prompt starters, style directions, resolution/aspect-ratio interactions and preset image geometry from [GPT Image Canvas](https://github.com/aruis/gpt-image-canvas).

Copyright (c) 2026 GPT Image Canvas contributors. The complete upstream MIT notice is retained in [licenses/gpt-image-canvas-MIT.txt](licenses/gpt-image-canvas-MIT.txt). Adaptations use Tuyile's PostgreSQL architecture, server-owned execution, explicit state management and Ant Design controls; no legacy credentials, private images or runtime data are incorporated.

## Main dependencies

| Component                                                                                | License / distribution note                                                                  |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| React, Ant Design, React Flow, React Router, TanStack Query, Hono, node-postgres, fflate | MIT; retain the notices shipped with the corresponding package versions                      |
| Drizzle ORM, sharp                                                                       | Apache-2.0; retain their package notices                                                     |
| Lucide React and selected D3 dependencies                                                | ISC; see package metadata and notices                                                        |
| Other D3 components                                                                      | Includes BSD-3-Clause; inspect the exact installed dependency tree                           |
| libvips and native dependencies bundled with sharp                                       | Includes LGPL-3.0-or-later, MPL and other licenses; not covered by Tuyile's Apache-2.0 grant |

fflate's MIT copyright and permission text is also retained in [licenses/fflate-MIT.txt](licenses/fflate-MIT.txt).

The pinned @rc-component/util 1.14.0 package (MIT) has a tracked patch forwarding the application CSP nonce to dynamic styles for scrollbar measurement and modal scroll locking. See [patches/README.md](patches/README.md). Original package notices remain intact.

## Native binary distribution

The libvips bundle has platform-specific components. [Upstream notices for sharp-libvips v1.3.4](licenses/sharp-libvips-THIRD-PARTY-NOTICES.md) are retained, along with [LGPLv3](licenses/LGPL-3.0.txt) and its incorporated [GPLv3 text](licenses/GPL-3.0.txt). The package's README and versions.json describe the actual installed bundle. Upstream packaging and corresponding-source build instructions are at [sharp-libvips](https://github.com/lovell/sharp-libvips/tree/v1.3.4).

Before distributing an image or other binary, inspect that target platform's packages, preserve all applicable notices, and satisfy corresponding-source and replacement/relinking requirements where applicable. A source-only inventory on one machine does not certify a different platform's binary distribution. Do not describe the complete dependency bundle as Apache-only.

## Content and external services

The software license does not grant model access, API credits, trademarks or rights to uploaded/generated material. No real user images, model credentials or generated design references are distributed in this repository. Examples and public screenshots must be independently reviewed for rights and privacy.
