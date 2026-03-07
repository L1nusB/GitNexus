# Refactor: Unify Skill Installation in `setup`, Remove from `analyze`

## Current Situation

GitNexus has two CLI commands that both install agent skills (static markdown files that teach AI agents GitNexus workflows):

### `gitnexus analyze`

- Primary purpose: index a git repository into a KuzuDB knowledge graph
- Secondary side effects:
  - Updates `CLAUDE.md` and `AGENTS.md` with dynamic stats (node count, edge count, process count, etc.)
  - Installs 6 skills to **project-local** `<repo>/.claude/skills/gitnexus/<skill-name>/SKILL.md`
- Runs frequently (after every significant code change, or automatically via post-commit hooks)
- Skill installation lives in `ai-context.ts::installSkills()` — a simpler, older implementation

### `gitnexus setup`

- Primary purpose: one-time global configuration (MCP server entries, hooks)
- Also installs 6 skills to **global** `~/.claude/skills/<skill-name>/SKILL.md`
- Runs once per machine
- Skill installation lives in `setup.ts::installSkillsTo()` — a more robust implementation that handles both flat files and directory-based skills with recursive copy

### The skills themselves

There are **7** skill files on disk in `gitnexus/skills/`:

| Skill File | Installed by `analyze` | Installed by `setup` |
|---|---|---|
| `gitnexus-exploring.md` | Yes | Yes |
| `gitnexus-debugging.md` | Yes | Yes |
| `gitnexus-impact-analysis.md` | Yes | Yes |
| `gitnexus-refactoring.md` | Yes | Yes |
| `gitnexus-guide.md` | Yes | Yes |
| `gitnexus-cli.md` | Yes | Yes |
| `gitnexus-pr-review.md` | **No** | **No** |

Both commands install the same 6 skills. `gitnexus-pr-review` exists on disk but is not installed by either command.

## Why This Is a Problem

### 1. Duplicate skills in Claude Code

When a user runs both `setup` and `analyze`, the same skills exist in two locations:
- `~/.claude/skills/gitnexus-exploring/SKILL.md` (global, from `setup`)
- `<repo>/.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` (project-local, from `analyze`)

This is a **known Claude Code bug** ([#25209](https://github.com/anthropics/claude-code/issues/25209)): when the same skill name exists in both global and project-local directories, both appear in the skill list instead of one shadowing the other. Users see each GitNexus skill listed twice.

### 2. Wrong responsibility boundary

Skills are static markdown files. They don't depend on the repository index, don't contain dynamic stats, and don't change between `analyze` runs. Installing them on every `analyze` invocation is unnecessary work in the wrong place.

The `analyze` command's purpose is indexing and generating dynamic context. Skill installation is static configuration — it belongs in `setup`.

### 3. Two implementations of the same logic

- `ai-context.ts::installSkills()` (lines 194-264) — simpler, only handles flat files, has hardcoded fallback descriptions
- `setup.ts::installSkillsTo()` (lines 254-289) — more robust, handles directory-based skills with recursive copy

Having two code paths for the same operation is a maintenance burden.

### 4. README inaccuracies

The README currently states:
- "**4 agent skills** installed to `.claude/skills/` automatically" (line 185) — there are actually 6 (missing `gitnexus-guide` and `gitnexus-cli`), plus 1 unlisted (`gitnexus-pr-review`)
- The README implies `analyze` handles everything: "This indexes the codebase, installs agent skills, registers Claude Code hooks, and creates `AGENTS.md` / `CLAUDE.md` context files — all in one command." (line 73) — but hooks are actually installed by `setup`, not `analyze`

## Options Considered

### Option A: Remove skills from `analyze`, keep only in `setup`
- Cleanest separation of concerns
- Risk: users who never run `setup` get no skills
- **Chosen approach** (with migration handling)

### Option B: Remove skills from `setup`, keep only in `analyze`
- Rejected: skills are static config, not index-dependent — wrong home

### Option C: Keep both but add deduplication logic
- Rejected: adds complexity to work around a bug that shouldn't exist in our code

### Option D: Add `--skills` flag to `analyze` for opt-in local installation
- Rejected by consensus (Gemini, Codex, and us): reintroduces the dual-location problem, adds a flag and code path for an edge case that contradicts the intended architecture

## Chosen Strategy

### 1. Remove skill installation from `analyze`

- Delete `installSkills()` from `ai-context.ts`
- Remove its call in `generateAIContextFiles()`
- `generateAIContextFiles()` becomes focused: only generates `CLAUDE.md` and `AGENTS.md` with dynamic index stats

### 2. `setup` is the single owner of skill installation

- Already has the better implementation (`installSkillsTo()`)
- Installs globally for Claude Code, Cursor, and OpenCode
- No changes needed to the installation logic itself

### 3. Migration: handle stale project-local skills

Two-part approach that respects command boundaries:

- **In `analyze`**: if `<repo>/.claude/skills/gitnexus/` exists, print a deprecation notice:
  `"Note: Skills are no longer installed by analyze. Run 'gitnexus setup' to manage skills globally."`
  No deletion — `analyze` doesn't own skills anymore and shouldn't destructively modify them.

- **In `setup`**: after installing global skills, check if the current working directory is a git repo with `.claude/skills/gitnexus/`. If so, remove it and print a notice:
  `"Removed project-local skills (now installed globally)"`
  This is safe because `setup` is actively taking ownership and replacing the local copy with a global one.

### 4. Update the `analyze` tip

The existing tip at `analyze.ts:363` says "Run `gitnexus setup` to configure MCP for your editor." Update it to also mention skills:
`"Run 'gitnexus setup' to configure MCP and install agent skills for your editor."`

### 5. Update README (separate commit)

- Fix skill count: 6 skills, not 4
- List all skills including `gitnexus-guide` and `gitnexus-cli`
- Clarify that `analyze` handles indexing + dynamic context, `setup` handles MCP + skills + hooks
- Correct line 73 which incorrectly attributes hooks to `analyze`

### 6. Future work (out of scope for this PR)

- Add `gitnexus-pr-review` to the `SKILL_NAMES` list in `setup.ts`
- Unify the skill name constants into a single shared location

## Files Changed

| File | Change |
|---|---|
| `gitnexus/src/cli/ai-context.ts` | Remove `installSkills()` function and its call |
| `gitnexus/src/cli/analyze.ts` | Add deprecation notice for stale local skills; update setup tip |
| `gitnexus/src/cli/setup.ts` | Export `installSkillsTo` and `SKILL_NAMES`; add cleanup of project-local skills during global install |
| `gitnexus/test/unit/ai-context.test.ts` | Add regression guards + post-refactor acceptance placeholders |
| `gitnexus/test/unit/setup-skills.test.ts` | New — tests `installSkillsTo` core logic + setup cleanup placeholders |
| `gitnexus/test/unit/analyze-skills-notice.test.ts` | New — tests stale skills deprecation notice helper |
| `README.md` | Fix skill count, clarify command responsibilities |

---

## Progress Log

### Phase 1: Research & Design (completed)

- Analyzed both commands (`analyze` and `setup`) to understand how each installs skills
- Identified the duplicate installation problem and its interaction with Claude Code bug [#25209](https://github.com/anthropics/claude-code/issues/25209)
- Consulted Gemini and Codex for architectural review — both agreed on the approach
- Evaluated 4 options (A–D), chose Option A with migration handling
- Documented the full strategy in this file

### Phase 2: Test Design & Implementation (completed)

- Designed test plan covering 21 test cases across 3 files (`docs/test-plan-skill-installation-refactor.md`)
- Exported `installSkillsTo` and `SKILL_NAMES` from `setup.ts` to enable direct testing
- Implemented tests in 3 files:
  - `test/unit/ai-context.test.ts` — 9 passing + 2 todo (post-refactor acceptance)
  - `test/unit/setup-skills.test.ts` — 5 passing + 6 todo (post-refactor acceptance)
  - `test/unit/analyze-skills-notice.test.ts` — 4 passing (notice helper works now)
- All 852 unit tests pass (39 files), no regressions
- Safety: all tests use `os.tmpdir()` temp directories, never touch real `~/.claude/` or working repo

### Phase 3: Implementation (pending)

- Remove `installSkills()` from `ai-context.ts`
- Add stale skills notice to `analyze`
- Add project-local cleanup to `setup`
- Update `analyze` tip to mention skills
- Flip `todo` tests to active, remove old skills test

### Phase 4: README Update (pending)

- Fix skill count (6, not 4)
- List all skills including `gitnexus-guide` and `gitnexus-cli`
- Clarify command responsibilities
