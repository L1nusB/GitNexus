# PR: Unify skill installation in `setup`, remove from `analyze`

## Title

`refactor(skills): unify installation in setup, auto-discover from disk`

## Description

### Summary

- Removes skill installation from `analyze` (was a side effect of indexing)
- Makes `setup` the single owner of skill installation (global only)
- Auto-discovers skill names from the `skills/` directory instead of hardcoding them
- Adds migration handling for users with stale project-local skills

### Problem

When users run both `gitnexus setup` and `gitnexus analyze`, the same skills get installed to two locations:

| Location | Installed by |
|----------|-------------|
| `~/.claude/skills/gitnexus-exploring/SKILL.md` | `setup` (global) |
| `<repo>/.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` | `analyze` (project-local) |

This triggers [Claude Code bug #25209](https://github.com/anthropics/claude-code/issues/25209) — both copies appear in the skill list instead of one shadowing the other. Users see every GitNexus skill listed twice.

Beyond the duplication bug, skills are static markdown files that don't depend on the repository index. Installing them on every `analyze` run is unnecessary work in the wrong place. There were also two separate implementations of the same install logic.

### Solution

**Single owner:** `setup` installs skills globally to `~/.claude/skills/`, `~/.cursor/skills/`, and `~/.config/opencode/skill/`. `analyze` no longer touches skills.

**Migration:** `analyze` prints a deprecation notice if stale project-local skills exist. `setup` cleans them up after installing globally.

**Auto-discovery:** Skill names are discovered from the `skills/` source directory at install time instead of being hardcoded. This automatically picks up `gitnexus-pr-review` (previously missing) and prevents future breakage when skills are added or renamed.

### Changes

| File | What changed |
|------|-------------|
| `gitnexus/src/cli/ai-context.ts` | Removed `installSkills()` function and its call; cleaned up unused imports |
| `gitnexus/src/cli/analyze.ts` | Added `checkStaleProjectSkills()` deprecation notice; updated setup tip to mention skills |
| `gitnexus/src/cli/setup.ts` | Added `discoverSkillNames()` replacing hardcoded list; added `cleanupProjectLocalSkills()` with worktree/submodule support |
| `gitnexus/test/unit/ai-context.test.ts` | Acceptance tests: `analyze` no longer installs skills; regression guards for dynamic context generation |
| `gitnexus/test/unit/setup-skills.test.ts` | `installSkillsTo` tests, `setupCommand` cleanup tests, `discoverSkillNames` discovery tests |
| `gitnexus/test/unit/analyze-skills-notice.test.ts` | Contract tests for `checkStaleProjectSkills` export and behavior |
| `README.md` | Fixed skill count (4 -> 7), corrected command responsibility descriptions |

### Design decisions

1. **Why not keep both locations?** Adds complexity to work around a bug that shouldn't exist in our code. Skills are static config — one canonical location is cleaner.

2. **Why doesn't `analyze` delete stale skills?** After the refactor, `analyze` no longer owns skills. Deleting them would cross the responsibility boundary. It warns; `setup` cleans up.

3. **Why auto-discover instead of hardcode?** The hardcoded `SKILL_NAMES` list was the root cause of `gitnexus-pr-review` being silently excluded. Discovery from disk means adding a new skill is just dropping a file — no code change required.

4. **Worktree/submodule support:** `cleanupProjectLocalSkills` walks upward to find the repo root, handling `.git` as either a directory (standard) or a file (worktrees/submodules).

### Test plan

- [x] `analyze` no longer creates `.claude/skills/gitnexus/` (acceptance tests 1-2)
- [x] `analyze` prints deprecation notice when stale skills exist (15-17)
- [x] `analyze` shows notice even on "Already up to date" early return
- [x] `setup` installs all 7 discovered skills with non-empty SKILL.md (7-9)
- [x] `setup` removes project-local skills in git repos (11-12)
- [x] `setup` handles nested dirs, worktrees, non-git dirs, empty dirs (13-14, nested/worktree tests)
- [x] `discoverSkillNames` discovers flat files, directories, mixed layouts (27-33)
- [x] `discoverSkillNames` filters to `gitnexus-*` prefix only (28)
- [x] `discoverSkillNames` ignores directories without SKILL.md (33)
- [x] `discoverSkillNames` documents collision behavior for same-name flat+directory entries (34)
- [x] `discoverSkillNames` propagates errors: missing root (`ENOENT`), permission failure (`EACCES`) (35-36)
- [x] `SKILL_NAMES` lazy-population contract: starts empty, populated after first install (37)
- [x] All existing tests unaffected — **874/874 passing**

### Commits

| Commit | Description |
|--------|-------------|
| `02eb465` | docs: create initial summary and tracking document |
| `b246c87` | test: add test suite for skill installation refactor |
| `c3f6995` | test(skills): activate pre-refactor acceptance suite |
| `c2ffb76` | refactor: unify skill installation in setup, remove from analyze |
| `f15b0aa` | fix(skills): cover worktree cleanup and no-op analyze notice |
| `c0f12a8` | docs: update README to reflect skill installation changes |
| `e132f77` | docs: plan auto-discovery of skill names from disk |
| `4a88ff6` | test: add acceptance tests for discoverSkillNames |
| `011b2c1` | feat(skills): auto-discover skill names from disk |
| `2fa3dd1` | test(skills): add discovery edge-case coverage (#34-37) |
