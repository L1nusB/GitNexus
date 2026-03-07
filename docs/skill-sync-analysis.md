# Skill Location Sync Analysis

## Context
During this PR, a maintainability concern came up: GitNexus skills currently exist in multiple locations with different directory layouts and potentially different content.

## What We Observed
Current locations in this branch:

- Canonical CLI package source: `gitnexus/skills/*.md`
- Claude plugin copy: `gitnexus-claude-plugin/skills/<skill>/SKILL.md`
- Cursor integration copy: `gitnexus-cursor-integration/skills/<skill>/SKILL.md`

Important facts from inspection:

- `gitnexus/skills` contains 7 skills.
- `gitnexus-claude-plugin/skills` contains 7 skills.
- `gitnexus-cursor-integration/skills` contains 5 skills (missing `gitnexus-cli` and `gitnexus-guide`).
- Some files are not content-identical across locations (there is real drift today).

## Question 1: Include in Current PR or Separate PR?

Recommendation: **separate PR**.

Reasoning:

- This is cross-cutting (core package + plugin folders + integration folders + CI), while current PR scope is skill installation/refactor behavior.
- Existing divergence indicates this is not purely mechanical sync; there may be intentional target differences.
- Bundling this now increases review risk and makes rollback harder.

## Question 2: How to Ensure Proper Sync?

Recommendation: move to **single source + generated targets + CI drift checks**.

### Proposed model

1. Define one canonical source of truth:
   - `gitnexus/skills/*.md`
2. Add a generator/sync script:
   - Example: `gitnexus/scripts/sync-skills.mjs`
3. Render target-specific outputs from canonical source:
   - `gitnexus-claude-plugin/skills/<name>/SKILL.md`
   - `gitnexus-cursor-integration/skills/<name>/SKILL.md`
4. Introduce explicit target policy (manifest/config):
   - Which skills each target includes/excludes.
   - This allows intentional subset behavior without accidental drift.
5. Mark generated files clearly:
   - Add header like `AUTO-GENERATED. DO NOT EDIT.`
6. Add CI verification:
   - Run sync in check mode.
   - Fail if generated output differs from committed files.

### Why this is better

- Prevents manual copy/paste drift.
- Makes target differences explicit and reviewable.
- Keeps edits centralized.
- Gives deterministic reproducibility in CI.

## Suggested Separate PR Scope

- Add sync script + manifest.
- Regenerate plugin/integration skill files.
- Add CI check job for drift.
- Add focused tests:
  - include/exclude target policy,
  - deterministic ordering,
  - parity with canonical source.

## Risks to Address in That PR

- Accidental behavior changes from normalizing formatting.
- Unclear policy for whether cursor intentionally excludes CLI/Guide.
- Developer confusion if generated files are edited directly.

## Final Recommendation

Proceed with a dedicated follow-up PR for skill source unification and generated syncing. Treat `gitnexus/skills/*.md` as canonical, generate all target copies from it, and enforce sync via CI.
