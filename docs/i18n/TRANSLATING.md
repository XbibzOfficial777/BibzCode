# Translation guide / Panduan penerjemahan

English `README.md` is BibzCode's canonical and default documentation. Translations
improve accessibility but must never silently change commands, security requirements,
or project policy.

README berbahasa Inggris adalah dokumentasi kanonis dan default BibzCode. Terjemahan
membantu aksesibilitas, tetapi tidak boleh mengubah command, persyaratan keamanan, atau
kebijakan proyek secara diam-diam.

## Adding or updating a language

1. Open a pull request against `nightly`.
2. Use a BCP 47-style code: `README.<code>.md`, for example `README.id.md`,
   `README.pt-BR.md`, or `README.zh-TW.md`.
3. Add the language to `docs/i18n/README.md` and the selector in the root README.
4. Link back to `../../README.md`, `../../SECURITY.md`, and
   `../../CONTRIBUTING.md`.
5. Preserve these values exactly:
   - `BibzCode`
   - `bzcli` and the temporary `dscli` compatibility name
   - commands, URLs, file paths, environment variables, package names, hashes, and
     version identifiers
6. Do not translate code blocks unless only their comments are prose.
7. Do not add tracking pixels, external scripts, URL shorteners, referral links, or
   third-party download mirrors.
8. Run `python scripts/check_community.py` and check every changed link.

## Translation quality

- Translate meaning, not word order.
- Prefer terminology familiar to technical readers of that language.
- Keep security statements at least as strict as the English source.
- Do not claim that an essential quick-start translation is a complete translation.
- A fluent human review is strongly preferred. AI-assisted text must be disclosed and
  reviewed under `CONTRIBUTING.md`.
- When uncertain, keep the technical term in English and add a local explanation.

## Sync policy

English may advance before all translations. Extended translations should state that
English controls when text conflicts. Essential translations must show their coverage
status and point readers to the full English document.

Security fixes should update affected translations in the same pull request whenever
practical. If not, the outdated translated statement must be removed or replaced by a
clear link to the corrected English policy.
