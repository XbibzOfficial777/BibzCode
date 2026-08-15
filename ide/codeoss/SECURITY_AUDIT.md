# Security audit policy

`security-lock-overrides.json` deterministically updates fixable high and critical
runtime advisories. Remaining findings are bounded:

- A tunnel dependency retains an older UUID implementation with a moderate advisory
  and no compatible upstream fix; the affected buffer-writing forms are not used by
  the product tunnel path.
- Markdown linkification and typographer processing are disabled by default to bound
  reported quadratic parser paths. Other fixable Markdown dependencies are upgraded.
- The image helper rejects ICNS/JXL/HEIF, disables remote probing, allowlists formats,
  and applies encoded/local file-size bounds before parsing.

`audit-prepared.mjs` rejects any new production advisory outside this allowlist.
Development-only build dependencies execute only on ephemeral pinned-input runners and
are not copied into release payloads.
