# BibzCode CLI 7.8.0

## Long-conversation memory

- Context-aware automatic compaction at 72% of model context or 80 active messages.
- Structured summary retains preferences, facts, decisions, files, completed work,
  tool outcomes, and pending tasks.
- Original turns move to a lossless archive and remain available after resume/export.
- `/compact` forces compaction; `/context` shows active/archive/token state.

## Telegram and Discord

- Handles current-message and replied-message context.
- Downloads current/replied attachments with a 25 MB default cap.
- Telegram: documents, photos, audio, voice, video, animation, video notes,
  stickers, contacts, locations, venues, polls, quotes, and forwards.
- Discord: attachments, referenced messages, embeds, stickers, polls, and mentions.
- Sanitized filenames, private file permissions, bot-token redaction.
- Per-platform/chat/user isolated conversation memory.
- Remote agents can read only exact downloaded attachments; arbitrary filesystem,
  shell, writes, browser side effects, and unapproved tools remain blocked.
- Explicit connector user-ID whitelists remain mandatory.

## Distribution

- GitHub remains the primary source.
- Verified Cloudflare release `7.8.0-r6` is the automatic fallback when GitHub is
  blocked or unavailable.
- React dashboard source is intentionally excluded and deployed separately.

## Verification

- 183 tests passed, 11 dashboard-specific tests skipped because dashboard source is
  intentionally not part of the public repository.
- Python compile and installer syntax checks passed.
