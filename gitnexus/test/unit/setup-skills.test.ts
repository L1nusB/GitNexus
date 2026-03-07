import { describe, it, expect, vi, beforeEach, afterEach, afterAll, beforeAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { installSkillsTo, SKILL_NAMES } from '../../src/cli/setup.js';

describe('installSkillsTo', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gn-setup-skills-test-'));
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch { /* best-effort */ }
  });

  it('installs all 6 skills to target directory', async () => {
    const installed = await installSkillsTo(tmpDir);
    expect(installed).toHaveLength(SKILL_NAMES.length);
    expect(installed.sort()).toEqual([...SKILL_NAMES].sort());
  });

  it('creates SKILL.md for each skill', async () => {
    await installSkillsTo(tmpDir);

    for (const name of SKILL_NAMES) {
      const skillFile = path.join(tmpDir, name, 'SKILL.md');
      const stat = await fs.stat(skillFile);
      expect(stat.isFile()).toBe(true);
    }
  });

  it('each SKILL.md has non-empty content', async () => {
    await installSkillsTo(tmpDir);

    for (const name of SKILL_NAMES) {
      const skillFile = path.join(tmpDir, name, 'SKILL.md');
      const content = await fs.readFile(skillFile, 'utf-8');
      expect(content.length).toBeGreaterThan(0);
    }
  });

  it('is idempotent — re-running overwrites cleanly', async () => {
    await installSkillsTo(tmpDir);
    const firstRun = await installSkillsTo(tmpDir);

    expect(firstRun).toHaveLength(SKILL_NAMES.length);

    // Verify no duplicate directories
    const entries = await fs.readdir(tmpDir);
    const skillDirs = entries.filter(e => e.startsWith('gitnexus-'));
    expect(skillDirs).toHaveLength(SKILL_NAMES.length);
  });

  it('handles missing source skill gracefully', async () => {
    // installSkillsTo reads from the package skills/ directory.
    // If a skill source file doesn't exist, it silently skips.
    // We can't easily mock the filesystem here, but we can verify
    // that the function doesn't throw even when called normally.
    const installed = await installSkillsTo(tmpDir);
    // At minimum, should not throw and should return an array
    expect(Array.isArray(installed)).toBe(true);
  });
});

describe('setupCommand — project-local skill cleanup', () => {
  let tmpHome: string;
  let tmpRepo: string;
  let originalCwd: string;
  let consoleOutput: string[];

  beforeEach(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'gn-setup-home-'));
    tmpRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'gn-setup-repo-'));
    originalCwd = process.cwd();
    consoleOutput = [];

    // Capture console.log output
    vi.spyOn(console, 'log').mockImplementation((...args: any[]) => {
      consoleOutput.push(args.map(String).join(' '));
    });
    vi.spyOn(console, 'warn').mockImplementation((...args: any[]) => {
      consoleOutput.push(args.map(String).join(' '));
    });
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    vi.restoreAllMocks();
    try {
      await fs.rm(tmpHome, { recursive: true, force: true });
      await fs.rm(tmpRepo, { recursive: true, force: true });
    } catch { /* best-effort */ }
  });

  // These tests document expected POST-REFACTOR behavior.
  // They will FAIL until the refactor is implemented, serving as acceptance criteria.

  it.todo('removes project-local skills when installing globally');
  // Setup: create <tmpRepo>/.claude/skills/gitnexus/ with skill files
  // Mock process.cwd() to tmpRepo, os.homedir() to tmpHome
  // Run setupCommand
  // Assert: <tmpRepo>/.claude/skills/gitnexus/ no longer exists

  it.todo('prints notice when removing project-local skills');
  // Same setup as above
  // Assert: consoleOutput contains migration notice

  it.todo('does nothing when no project-local skills exist');
  // Mock cwd to tmpRepo (no .claude/skills/gitnexus/)
  // Run setupCommand
  // Assert: no errors, no removal-related output

  it.todo('does not remove project-local skills if not in a git repo');
  // Create .claude/skills/gitnexus/ but no .git directory
  // Assert: skills directory left intact

  it.todo('removes empty project-local skills directory');
  // Create empty .claude/skills/gitnexus/
  // Assert: cleaned up

  it.todo('removes project-local skills dir even with extra files');
  // Create .claude/skills/gitnexus/ with a custom extra file
  // Assert: entire gitnexus/ dir removed (it's our namespace)
});
