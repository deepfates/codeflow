# Third-party browser dependencies

CodeFlow vendors these pinned browser assets so local analysis can start without network access.
Circular Sankey and its dependencies are bundled from the locked npm packages by scripts/build.mjs.
The exact source URL and SHA-256 digest for every distributed asset are recorded in `manifest.json`.

| Package | Version | License | License text |
| --- | --- | --- | --- |
| `d3-sankey-circular` | `0.34.0` | MIT | [`licenses/d3-sankey-circular-LICENSE.txt`](./licenses/d3-sankey-circular-LICENSE.txt) |
| `d3-array` | `1.2.4` | BSD-3-Clause | [`licenses/d3-array-LICENSE.txt`](./licenses/d3-array-LICENSE.txt) |
| `d3-collection` | `1.0.7` | BSD-3-Clause | [`licenses/d3-collection-LICENSE.txt`](./licenses/d3-collection-LICENSE.txt) |
| `d3-shape` | `1.3.7` | BSD-3-Clause | [`licenses/d3-shape-LICENSE.txt`](./licenses/d3-shape-LICENSE.txt) |
| `d3-path` | `1.0.9` | BSD-3-Clause | [`licenses/d3-path-LICENSE.txt`](./licenses/d3-path-LICENSE.txt) |
| `elementary-circuits-directed-graph` | `1.3.1` | MIT | [`licenses/elementary-circuits-directed-graph-LICENSE.txt`](./licenses/elementary-circuits-directed-graph-LICENSE.txt) |
| `strongly-connected-components` | `1.0.1` | MIT | [`licenses/strongly-connected-components-LICENSE.txt`](./licenses/strongly-connected-components-LICENSE.txt) |
| `react` | `18.2.0` | MIT | [`licenses/react-LICENSE.txt`](./licenses/react-LICENSE.txt) |
| `react-dom` | `18.2.0` | MIT | [`licenses/react-dom-LICENSE.txt`](./licenses/react-dom-LICENSE.txt) |
| `@babel/standalone` | `7.23.5` | MIT | [`licenses/babel-standalone-LICENSE.txt`](./licenses/babel-standalone-LICENSE.txt) |
| `d3` | `7.8.5` | ISC | [`licenses/d3-LICENSE.txt`](./licenses/d3-LICENSE.txt) |
| `acorn` | `8.11.3` | MIT | [`licenses/acorn-LICENSE.txt`](./licenses/acorn-LICENSE.txt) |
| `jsrsasign` | `11.1.0` | MIT | [`licenses/jsrsasign-LICENSE.txt`](./licenses/jsrsasign-LICENSE.txt) |
| `jszip` | `3.10.1` | MIT OR GPL-3.0-or-later | [`licenses/jszip-LICENSE.txt`](./licenses/jszip-LICENSE.txt) |
| `web-tree-sitter` | `0.20.8` | MIT | [`licenses/web-tree-sitter-LICENSE.txt`](./licenses/web-tree-sitter-LICENSE.txt) |
| `jspdf` | `2.5.1` | MIT | [`licenses/jspdf-LICENSE.txt`](./licenses/jspdf-LICENSE.txt) |
| `mermaid` | `10.9.1` | MIT | [`licenses/mermaid-LICENSE.txt`](./licenses/mermaid-LICENSE.txt) |
| `3d-force-graph` | `1.80.0` | MIT | [`licenses/3d-force-graph-LICENSE.txt`](./licenses/3d-force-graph-LICENSE.txt) |
| `tree-sitter-wasms` | `0.1.13` | MIT | [`licenses/tree-sitter-wasms-LICENSE.txt`](./licenses/tree-sitter-wasms-LICENSE.txt) |
| `@fontsource/jetbrains-mono` | `5.3.0` | OFL-1.1 | [`licenses/fontsource-jetbrains-mono-LICENSE.txt`](./licenses/fontsource-jetbrains-mono-LICENSE.txt) |

3d-force-graph 1.80.0 carries a narrow pointerup correction in [`scripts/patch-3d-force-graph.mjs`](../scripts/patch-3d-force-graph.mjs). The manifest records both upstream and distributed hashes; the vendoring command reapplies the correction.

Regenerate the checked-in files with `node scripts/vendor-browser-deps.mjs`.
