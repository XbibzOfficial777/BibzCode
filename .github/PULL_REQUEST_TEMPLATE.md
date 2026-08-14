## Summary

<!-- What problem does this PR solve, and why is this approach appropriate? -->

## Related issue

<!-- Use “Closes #123” when applicable. Large changes should have an issue first. -->

## Type of change

- [ ] Bug fix
- [ ] Feature
- [ ] Documentation, translation, or tests only
- [ ] Refactor with no intended behavior change
- [ ] Security hardening (no undisclosed vulnerability details)
- [ ] Approved compatibility or release change

## Validation

<!-- List exact commands and results. Do not paste credentials or unsanitized logs. -->

- [ ] `python -m compileall -q bibzcode deepseek tests`
- [ ] `python -m pytest -q`
- [ ] `python scripts/check_community.py`
- [ ] Additional relevant checks are listed above

## Security and compatibility

- [ ] I did not commit credentials, private data, database exports, `.env` files, or deployment state.
- [ ] I did not add `dashboard-react/` or deployment-only dashboard code.
- [ ] New user-visible names use BibzCode and `bzcli`.
- [ ] Legacy names appear only in explicit compatibility/migration code.
- [ ] I considered filesystem, network, process, authentication, redaction, and connector trust boundaries.
- [ ] I added a negative/regression test for any changed security boundary.

## Documentation and release integrity

- [ ] User-facing behavior is documented, or documentation is not applicable.
- [ ] I did not alter generated archives/checksums, or this is an approved release change regenerated with `scripts/build_release.py`.
- [ ] I reviewed every submitted line, including any AI-assisted content, and disclosed substantial AI assistance below.

## Additional context / AI assistance disclosure

<!-- Screenshots, design trade-offs, migration notes, or disclosure. Use synthetic data. -->
