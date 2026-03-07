# Test Plan: Skill Installation Refactor

## Test Infrastructure

- **Framework**: Vitest (already used, v4.x)
- **Location**: `gitnexus/test/unit/` for unit tests, `gitnexus/test/integration/` for integration
- **Run**: `npm test` (unit only), `npm run test:all` (unit + integration)
- **Isolation**: All tests use `os.tmpdir()` temp directories — no real `~/.claude/` or repo modification

## Safety Approach

All filesystem operations happen inside `fs.mkdtemp()` temp directories, cleaned up in `afterAll`. Tests never touch:
- The real `~/.claude/` directory
- The real working repository
- Any global state

For functions that reference `os.homedir()`, we mock the return value to point at a temp directory.

## Existing Tests to Update

### `test/unit/ai-context.test.ts`

The existing test at line 67-79 (`it('installs skills files')`) tests that `generateAIContextFiles` installs skills. After the refactor, this behavior is removed. This test must be updated.

| # | Test | Assertion | Notes |
|---|------|-----------|-------|
| 1 | `generateAIContextFiles` does NOT install skills | Skills directory `.claude/skills/gitnexus/` should not exist after calling `generateAIContextFiles` | Inverts existing test |
| 2 | Return value does not mention skills | `result.files` should not contain any skill-related entries | |

## New Unit Tests: `test/unit/ai-context.test.ts` (additions)

### `generateAIContextFiles` — post-refactor behavior

| # | Test | Setup | Assertion |
|---|------|-------|-----------|
| 3 | Still generates CLAUDE.md with dynamic stats | Call with `{ nodes: 100, edges: 200, processes: 10 }` | CLAUDE.md contains `100 symbols`, `200 relationships`, `10 execution flows` |
| 4 | Still generates AGENTS.md | Call with stats | AGENTS.md exists with gitnexus markers |
| 5 | Idempotent — no duplicate sections on re-run | Call twice with different stats | Only one `gitnexus:start` marker, second stats overwrite first |
| 6 | Preserves existing non-GitNexus content in CLAUDE.md | Pre-create CLAUDE.md with custom content, then call | Custom content still present alongside gitnexus section |

## New Unit Tests: `test/unit/setup-skills.test.ts`

These test the skill installation logic in `setup.ts`. Since `setupCommand` does many things (MCP config, hooks, skills), we need to test the skill-related functions. The key functions are not currently exported, so we'll either:
- Extract and export `installSkillsTo` (it's already a standalone function)
- Or test via `setupCommand` with mocked filesystem

### `installSkillsTo` — core skill installation

| # | Test | Setup | Assertion |
|---|------|-------|-----------|
| 7 | Installs all 6 skills to target directory | Call with temp dir as target | Each of the 6 skill directories exists with a `SKILL.md` file |
| 8 | Each SKILL.md has non-empty content | Call with temp dir | Every `SKILL.md` has length > 0 |
| 9 | Idempotent — re-running overwrites cleanly | Call twice | Same 6 skills, no duplicates, no errors |
| 10 | Handles missing source skill gracefully | Mock one skill file as missing | Other 5 install successfully, missing one is skipped |

### `setupCommand` — cleanup of project-local skills

| # | Test | Setup | Assertion |
|---|------|-------|-----------|
| 11 | Removes project-local skills when installing globally | Create `.claude/skills/gitnexus/` in a fake repo dir, mock `process.cwd()` to that dir | Directory removed after setup |
| 12 | Prints notice when removing project-local skills | Same as above, capture console output | Output contains migration notice |
| 13 | Does nothing when no project-local skills exist | Mock cwd to a dir without `.claude/skills/gitnexus/` | No errors, no removal attempted |
| 14 | Does not remove project-local skills if not in a git repo | Create `.claude/skills/gitnexus/` but no `.git` directory | Skills directory left intact (not a repo, don't touch) |

## New Unit Tests: `test/unit/analyze-skills-notice.test.ts`

These test the deprecation notice in `analyze` when stale project-local skills are detected.

Since `analyzeCommand` is heavy (requires KuzuDB, pipeline, etc.), we don't test the full command. Instead, we test the notice logic as an extracted helper or verify it through console output mocking.

| # | Test | Setup | Assertion |
|---|------|-------|-----------|
| 15 | Prints deprecation notice when `.claude/skills/gitnexus/` exists | Create the directory in temp repo, capture console | Output contains "no longer installed by analyze" or similar |
| 16 | No notice when `.claude/skills/gitnexus/` does not exist | Don't create the directory | No skill-related console output |
| 17 | Notice does NOT delete the directory | Create directory, run the check | Directory still exists after |

## Edge Cases

| # | Test | Location | Setup | Assertion |
|---|------|----------|-------|-----------|
| 18 | Existing CLAUDE.md with gitnexus section but no skills dir | ai-context test | Pre-create CLAUDE.md with markers, no skills dir | Updates section, doesn't create skills dir |
| 19 | Skills dir exists but is empty | setup test | Create empty `.claude/skills/gitnexus/` | Cleanup still removes it |
| 20 | Skills dir contains extra files (user-modified) | setup test | Add custom file alongside skill files | Still removes entire gitnexus skills dir (it's our namespace) |
| 21 | Read-only skills directory | setup test | Create dir with restricted permissions | Graceful error, doesn't crash |

## Test File Summary

| File | Tests | Type |
|------|-------|------|
| `test/unit/ai-context.test.ts` | #1-6, #18 | Unit — update existing + add new |
| `test/unit/setup-skills.test.ts` | #7-14, #19-21 | Unit — new file |
| `test/unit/analyze-skills-notice.test.ts` | #15-17 | Unit — new file |

## Running Tests Pre-Implementation

These tests can be written and run **before** the actual refactor. Here's the strategy:

- **Tests that verify NEW behavior** (#1, #2, #11, #12, #15-17, #19, #20): Keep them active and expect them to **fail** until implementation lands. They are the acceptance criteria.
- **Tests that verify EXISTING behavior we're keeping** (#3-6, #18): Write them now, expect them to **pass** both before and after the refactor. They're regression guards.
- **Tests for setup skills** (#7-10): These test `installSkillsTo` directly and should pass now.
- **Deferred edge case** (#21): Keep as planned while cleanup implementation is pending.

## Execution

```bash
# Run just the skill-related tests
cd gitnexus
npx vitest run test/unit/ai-context.test.ts test/unit/setup-skills.test.ts test/unit/analyze-skills-notice.test.ts

# Run all unit tests (verify no regressions)
npm test
```

## Changelog

### 2026-03-07 — Pre-refactor test hardening

- Switched acceptance checks from placeholder `it.todo(...)` to active tests for:
  - `generateAIContextFiles` no longer installing skills (#1, #2)
  - `setupCommand` migration cleanup behavior (#11, #12, #19, #20)
- Reworked `analyze` notice tests to target production-code contract instead of a local test-only helper:
  - Tests now require `analyze.ts` to export `checkStaleProjectSkills(repoPath)` and validate behavior through that symbol (#15-#17).
  - This removes false confidence where tests could pass without any production integration.
- Strengthened weak-path assertions:
  - `ai-context` tests now use per-test temp directories (`beforeEach`/`afterEach`) to remove shared state leakage.
  - Replaced the permissive "installs skills files" try/catch test with strict assertions.
  - `installSkillsTo` missing-source test now simulates one missing skill via mocked `fs.readFile` and verifies partial install outcome (#10).
- Intentional status in this phase:
  - Acceptance tests are expected to fail until refactor implementation lands.
  - Regression/behavior-preservation tests should continue to pass.
  - Read-only cleanup scenario (#21) remains planned and should be finalized when cleanup implementation exists.
