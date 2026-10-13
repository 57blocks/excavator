---
name: excavator-view
description: Write a static, self-contained HTML view of a project's Excavator analysis that opens in any browser from file://, with no server, no network and no installed tools.
---

# /excavator-view

Writes `.excavator/view.html`: one HTML file holding the page and the analysis data, which anyone can open by double-clicking. The data travels in the `excavator-view-bundle/1` format described in `FORMAT.md` next to this file; `bundle-codec.mjs` is its single encoder and decoder, shared with the page template in `packages/view`.

This skill is being assembled in steps; the bake command and its flags are documented here once they exist. It never calls a model, never starts a server or binds a port, and writes nothing but the output file.
