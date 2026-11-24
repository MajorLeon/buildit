# Task: <name>

Owner: <person> · Branch: `task/<name>` · Worktree: `.claude/worktrees/<name>` (or your own folder)

## Goal
One or two sentences: what changes for the person building furniture.

## Files you may touch
- `path/one.js`
- (nothing else; ask the lead first)

## Contracts to respect
- The guide format in `web/src/guide.js`, API routes and the database: change only after agreeing with the lead.

## Acceptance check
Commands that must pass, and what you expect to see:
```bash
npm run build
node scripts/check-guide.mjs web/public/examples/bookcase.json
```
UI changes: screenshots at desktop 1280×860 and phone 390×844.

## Handoff
Where it stands if someone (or another AI tool) picks it up: what is done, the next step, open questions.
