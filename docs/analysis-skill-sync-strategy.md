# Analysis: Skill File Synchronization Strategy

## Problem Statement

GitNexus agent skills (markdown files teaching AI assistants workflows) exist in **4 locations** within the same repository, all checked into git:

| Location | Count | Format | Extras | Purpose |
|----------|-------|--------|--------|---------|
| `gitnexus/skills/` | 7 | flat `{name}.md` | YAML frontmatter | Source for `setup.ts` (runtime install) |
| `.claude/skills/gitnexus/` | 7 | `{name}/SKILL.md` | — | Project-local skills for devs working on GitNexus itself |
| `gitnexus-claude-plugin/skills/` | 7 | `{name}/SKILL.md` | `mcp.json` per skill (6 of 7) | Claude Code plugin package |
| `gitnexus-cursor-integration/skills/` | 5 | `{name}/SKILL.md` | — | Cursor editor integration (subset) |

**Total: 26 skill files representing 7 unique skills.**

### Drift has already occurred

The Cursor integration copies have different frontmatter descriptions than the source:

```
# Source (gitnexus/skills/gitnexus-debugging.md)
description: "Use when the user is debugging a bug, tracing an error, ..."

# Cursor (gitnexus-cursor-integration/skills/gitnexus-debugging/SKILL.md)
description: Trace bugs through call chains using knowledge graph
```

This drift happened silently — there is no mechanism to detect or prevent it.

### Why this matters

- A skill content fix applied to `gitnexus/skills/` will NOT propagate to the plugin or Cursor integration
- The Cursor integration is missing 2 skills (CLI, guide) — it's unclear whether this is intentional
- Adding a new skill requires manually creating it in up to 4 locations with 2 different directory structures

---

## Scoping Decision: This PR or Separate?

### Consensus across all models: Separate PR

| Model | Recommendation | Reasoning |
|-------|---------------|-----------|
| **Gemini** | Separate PR titled `chore: centralize skill definitions` | Involves new script, workspace wiring, and a reconciliation step for drifted content — deserves isolated review |
| **Codex** | Split: add CI parity check now, full sync script in follow-up | Reduces risk in an already-active PR while providing an immediate guardrail |
| **Web research** | N/A (focused on patterns, not scoping) | — |

**Recommendation:** Keep the current PR focused on the installation refactor. Open a new PR for sync infrastructure. Optionally, a lightweight CI drift-detection check could be added now as an immediate guardrail.

---

## Strategy Options

### Option A: Build-time sync script (recommended)

A `scripts/sync-skills.ts` script that reads from the canonical source and generates the derived copies.

**How it works:**
1. Reads flat `.md` files from `gitnexus/skills/` (single source of truth)
2. For each target integration:
   - Creates `{name}/SKILL.md` directory structure
   - Preserves integration-specific extras (`mcp.json`) — script only overwrites `SKILL.md`
   - Respects an **allowlist** per integration (e.g., Cursor only gets 5 of 7)
3. Wired as `npm run sync:skills` at the workspace root

**Per-integration config (e.g., `skills.manifest.json`):**
```json
{
  "skills": ["gitnexus-exploring", "gitnexus-debugging", "gitnexus-impact-analysis", "gitnexus-refactoring", "gitnexus-pr-review"]
}
```

**Enforcement:** CI runs the script and fails on `git diff --exit-code` if output is dirty.

| Dimension | Assessment |
|-----------|-----------|
| Can drift silently? | No (CI catches it) |
| DX | Good — run one command |
| Platform compat | Excellent (Node.js) |
| Complexity | Low-medium |
| Handles extras (mcp.json) | Yes — only overwrites SKILL.md |
| Handles subsets | Yes — via allowlist |

### Option B: Symlinks

Replace derived copies with symlinks pointing to `gitnexus/skills/`.

| Dimension | Assessment |
|-----------|-----------|
| Can drift silently? | No |
| DX | Excellent — edit once |
| Platform compat | **Poor** — Windows needs Developer Mode; `npm publish` silently drops symlinked files ([npm/cli#6746](https://github.com/npm/cli/issues/6746)) |
| Complexity | Low |
| Handles extras (mcp.json) | No — can't symlink a file into a directory that also needs non-symlinked files |
| Handles subsets | Awkward — would need selective symlinking |

**Verdict:** Ruled out due to npm publish breakage and inability to handle `mcp.json` companions.

### Option C: CI drift-detection only (no sync script)

A CI job diffs each derived copy against the canonical source and fails on mismatch.

| Dimension | Assessment |
|-----------|-----------|
| Can drift silently? | No |
| DX | Moderate — developer must manually copy after editing |
| Platform compat | Excellent |
| Complexity | Very low |
| Handles extras | N/A — doesn't sync, just detects |
| Handles subsets | N/A |

**Verdict:** Good as a backstop, insufficient alone. Developers would need to manually create directory-structured copies from flat files — error-prone.

### Option D: Git pre-commit hook

Husky hook runs sync validation or auto-copy on commit.

| Dimension | Assessment |
|-----------|-----------|
| Can drift silently? | Yes (`--no-verify`) |
| DX | Very good when it works |
| Platform compat | Good |
| Complexity | Medium |

**Verdict:** Good local DX supplement, but bypassable. Must be paired with CI check.

---

## Recommended Approach: A + C (sync script + CI check)

### Layered strategy

1. **`scripts/sync-skills.ts`** — the sync engine
   - Reads `gitnexus/skills/*.md` as canonical source
   - Writes to 3 targets: `.claude/skills/gitnexus/`, `gitnexus-claude-plugin/skills/`, `gitnexus-cursor-integration/skills/`
   - Each target has a `skills.manifest.json` declaring which skills it includes
   - Script only overwrites `SKILL.md` files — leaves `mcp.json` and other extras untouched
   - Handles format conversion (flat `.md` → `{name}/SKILL.md` directory structure)

2. **CI parity check** — the safety net
   - Runs `npm run sync:skills` then checks `git diff --exit-code`
   - Fails the PR if any derived file is out of sync
   - Zero false positives — the script IS the source of truth

3. **Optional: pre-commit hook** — local convenience
   - Runs sync script and re-stages changed files
   - Nice-to-have, not relied upon for correctness

### What about frontmatter differences?

The Cursor integration has different `description` values. Two options:

- **Option 1: Strip frontmatter from derived copies.** If derived SKILL.md files don't need the YAML header (Claude Code / Cursor may not use it), just copy the content body.
- **Option 2: Allow per-integration frontmatter overrides.** The manifest includes optional frontmatter fields that the sync script injects when generating that target's copy.

Recommendation: Investigate whether Claude Code and Cursor actually consume the YAML frontmatter. If not, strip it from derived copies (simpler). If they do, use per-integration overrides in the manifest.

---

## Industry Context

### What popular monorepos do

| Project | Strategy |
|---------|----------|
| **Babel** | Package READMEs generated as part of build/release — not manually synced |
| **Next.js (Vercel)** | Shared config published as separate workspace packages; docs live in one place |
| **Nx** | Uses Nx generators to scaffold and re-generate files from templates |
| **General pattern** | Avoid duplicating content entirely; when duplication is necessary, generate at build time |

### Available tools

| Tool | What it does | Fit for our case |
|------|-------------|-----------------|
| [syncpack](https://syncpack.dev/) | Syncs `package.json` versions | No — wrong domain |
| [BetaHuhn/repo-file-sync-action](https://github.com/BetaHuhn/repo-file-sync-action) | GitHub Action for cross-repo file sync | Possible but heavy |
| Custom script | Reads source, writes derived copies | Best fit — simple, tailored |

**Key finding:** No widely-adopted npm package exists for syncing arbitrary content files within a monorepo. Teams roll their own scripts.

---

## Implementation Outline (for the follow-up PR)

### Phase 1: Reconcile drifted content
- Diff all 4 locations and decide on canonical content for each skill
- Update `gitnexus/skills/` with the best version
- Manual one-time task

### Phase 2: Build the sync script
- `scripts/sync-skills.ts` reading from `gitnexus/skills/`
- Per-target `skills.manifest.json` with allowlist
- `npm run sync:skills` at workspace root

### Phase 3: CI enforcement
- Add a CI step that runs sync and checks for dirty state
- Optionally add Husky pre-commit hook

### Phase 4: Documentation
- Update CONTRIBUTING.md or developer docs explaining the skill authoring workflow
- "Edit skills only in `gitnexus/skills/`, run `npm run sync:skills`, commit the result"

---

## Summary

| Question | Answer |
|----------|--------|
| One source or independent? | **One canonical source: `gitnexus/skills/`** |
| Sync mechanism? | **Build-time script + CI parity check** |
| Handle Cursor subset? | **Explicit allowlist per integration** |
| This PR or separate? | **Separate PR** (current one stays focused on installation refactor) |
| Immediate action? | Optionally add a CI drift-detection check now as a lightweight guardrail |

---

## Model Consultation Summary

### Gemini
- Canonical source: `gitnexus/skills/` (simplest common denominator)
- Sync: build-time Node script, run as postinstall
- Cursor subset: explicit inclusion lists per integration
- Separate PR: yes, the sync architecture deserves isolated review
- Rejected symlinks (cross-platform), CI-only (reactive/punitive), `.claude/skills/` as SSoT (too editor-specific)

### Codex
- Canonical source: `gitnexus/skills/` (already what `setup.ts` uses)
- Sync: build script + CI parity check (`git diff --exit-code`)
- Cursor subset: explicit allowlist in `skills.manifest.json`
- Split delivery: CI check now, full sync script later
- Confirmed drift in `gitnexus-impact-analysis` descriptions

### Web Research (Claude + WebSearch)
- Build-time copy scripts are the most widely used approach in monorepos
- Symlinks break with `npm publish` (npm/cli#6746) and Windows (npm/cli#4138)
- No established npm package for arbitrary file sync — teams roll their own
- Popular monorepos (Babel, Next.js, Nx) avoid duplication or generate at build time
- Recommended layered approach: sync script + CI check + optional pre-commit hook
