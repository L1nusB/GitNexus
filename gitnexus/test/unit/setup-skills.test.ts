import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { installSkillsTo, SKILL_NAMES, setupCommand } from '../../src/cli/setup.js';

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
    const missingSkill = SKILL_NAMES[SKILL_NAMES.length - 1];
    const originalReadFile = fs.readFile.bind(fs);
    const readFileSpy = vi.spyOn(fs, 'readFile').mockImplementation(async (...args: any[]) => {
      const filePath = String(args[0]);
      if (filePath.endsWith(`${missingSkill}.md`)) {
        const err = new Error('ENOENT');
        (err as NodeJS.ErrnoException).code = 'ENOENT';
        throw err;
      }
      return originalReadFile(...args as any);
    });

    const installed = await installSkillsTo(tmpDir);
    readFileSpy.mockRestore();

    expect(installed).toHaveLength(SKILL_NAMES.length - 1);
    expect(installed).not.toContain(missingSkill);
    for (const name of SKILL_NAMES.filter(n => n !== missingSkill)) {
      const skillFile = path.join(tmpDir, name, 'SKILL.md');
      const stat = await fs.stat(skillFile);
      expect(stat.isFile()).toBe(true);
    }
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
    process.chdir(tmpRepo);

    vi.spyOn(os, 'homedir').mockReturnValue(tmpHome);

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

  it('removes project-local skills when installing globally', async () => {
    await fs.mkdir(path.join(tmpHome, '.claude'), { recursive: true });
    await fs.mkdir(path.join(tmpRepo, '.git'), { recursive: true });
    const localSkillsDir = path.join(tmpRepo, '.claude', 'skills', 'gitnexus');
    await fs.mkdir(path.join(localSkillsDir, 'gitnexus-exploring'), { recursive: true });
    await fs.writeFile(path.join(localSkillsDir, 'gitnexus-exploring', 'SKILL.md'), 'legacy skill');

    await setupCommand();

    await expect(fs.stat(localSkillsDir)).rejects.toThrow();
  });

  it('prints notice when removing project-local skills', async () => {
    await fs.mkdir(path.join(tmpHome, '.claude'), { recursive: true });
    await fs.mkdir(path.join(tmpRepo, '.git'), { recursive: true });
    const localSkillsDir = path.join(tmpRepo, '.claude', 'skills', 'gitnexus');
    await fs.mkdir(localSkillsDir, { recursive: true });

    await setupCommand();

    const migrationNotice = consoleOutput.find(line => line.includes('Removed project-local skills'));
    expect(migrationNotice).toBeDefined();
  });

  it('does nothing when no project-local skills exist', async () => {
    await fs.mkdir(path.join(tmpHome, '.claude'), { recursive: true });
    await fs.mkdir(path.join(tmpRepo, '.git'), { recursive: true });

    await setupCommand();

    const migrationNotice = consoleOutput.find(line => line.includes('Removed project-local skills'));
    expect(migrationNotice).toBeUndefined();
  });

  it('does not remove project-local skills if not in a git repo', async () => {
    await fs.mkdir(path.join(tmpHome, '.claude'), { recursive: true });
    const localSkillsDir = path.join(tmpRepo, '.claude', 'skills', 'gitnexus');
    await fs.mkdir(localSkillsDir, { recursive: true });

    await setupCommand();

    const stat = await fs.stat(localSkillsDir);
    expect(stat.isDirectory()).toBe(true);
  });

  it('removes empty project-local skills directory', async () => {
    await fs.mkdir(path.join(tmpHome, '.claude'), { recursive: true });
    await fs.mkdir(path.join(tmpRepo, '.git'), { recursive: true });
    const localSkillsDir = path.join(tmpRepo, '.claude', 'skills', 'gitnexus');
    await fs.mkdir(localSkillsDir, { recursive: true });

    await setupCommand();

    await expect(fs.stat(localSkillsDir)).rejects.toThrow();
  });

  it('removes project-local skills dir even with extra files', async () => {
    await fs.mkdir(path.join(tmpHome, '.claude'), { recursive: true });
    await fs.mkdir(path.join(tmpRepo, '.git'), { recursive: true });
    const localSkillsDir = path.join(tmpRepo, '.claude', 'skills', 'gitnexus');
    await fs.mkdir(localSkillsDir, { recursive: true });
    await fs.writeFile(path.join(localSkillsDir, 'README.txt'), 'user custom note');

    await setupCommand();

    await expect(fs.stat(localSkillsDir)).rejects.toThrow();
  });
});
