import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

/**
 * Tests for the deprecation notice in analyze when stale project-local skills exist.
 *
 * After the refactor, `analyze` no longer installs skills but should warn
 * if it detects a leftover `.claude/skills/gitnexus/` directory from a prior run.
 *
 * The notice logic will be extracted as a small helper from analyze.ts (or ai-context.ts)
 * so we can test it without running the full analyze pipeline.
 */

// Placeholder for the function that will be extracted during refactor.
// For now we define the expected interface and test against it.
// Once implemented, update the import to point to the real function.

/**
 * Check for stale project-local skills and print a deprecation notice.
 * Returns true if stale skills were detected.
 */
async function checkStaleProjectSkills(repoPath: string): Promise<boolean> {
  const skillsDir = path.join(repoPath, '.claude', 'skills', 'gitnexus');
  try {
    const stat = await fs.stat(skillsDir);
    if (stat.isDirectory()) {
      console.log(`  Note: Skills are no longer installed by analyze. Run 'gitnexus setup' to manage skills globally.`);
      return true;
    }
  } catch {
    // Directory doesn't exist — nothing to warn about
  }
  return false;
}

describe('analyze — stale project-local skills notice', () => {
  let tmpDir: string;
  let consoleOutput: string[];

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gn-analyze-notice-test-'));
    consoleOutput = [];
    vi.spyOn(console, 'log').mockImplementation((...args: any[]) => {
      consoleOutput.push(args.map(String).join(' '));
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch { /* best-effort */ }
  });

  it('prints deprecation notice when .claude/skills/gitnexus/ exists', async () => {
    // Create stale project-local skills directory with a skill file inside
    const skillSubDir = path.join(tmpDir, '.claude', 'skills', 'gitnexus', 'gitnexus-exploring');
    await fs.mkdir(skillSubDir, { recursive: true });
    await fs.writeFile(path.join(skillSubDir, 'SKILL.md'), 'stale');

    const detected = await checkStaleProjectSkills(tmpDir);

    expect(detected).toBe(true);
    const notice = consoleOutput.find(line => line.includes('no longer installed by analyze'));
    expect(notice).toBeDefined();
  });

  it('prints no notice when .claude/skills/gitnexus/ does not exist', async () => {
    const detected = await checkStaleProjectSkills(tmpDir);

    expect(detected).toBe(false);
    const notice = consoleOutput.find(line => line.includes('no longer installed by analyze'));
    expect(notice).toBeUndefined();
  });

  it('does NOT delete the directory — only warns', async () => {
    const skillsDir = path.join(tmpDir, '.claude', 'skills', 'gitnexus');
    await fs.mkdir(skillsDir, { recursive: true });

    await checkStaleProjectSkills(tmpDir);

    // Directory must still exist
    const stat = await fs.stat(skillsDir);
    expect(stat.isDirectory()).toBe(true);
  });

  it('handles .claude dir existing without skills/gitnexus/', async () => {
    // .claude exists but no skills subdirectory
    await fs.mkdir(path.join(tmpDir, '.claude'), { recursive: true });

    const detected = await checkStaleProjectSkills(tmpDir);
    expect(detected).toBe(false);
  });
});
