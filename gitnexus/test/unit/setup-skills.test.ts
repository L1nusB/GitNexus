import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { installSkillsTo, SKILL_NAMES, setupCommand } from '../../src/cli/setup.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Resolve the real skills source directory used by setup.ts */
const SKILLS_ROOT = path.join(__dirname, '..', '..', 'skills');

/**
 * Dynamically import discoverSkillNames from setup.ts.
 * Returns null if the export doesn't exist yet (pre-implementation).
 */
async function getDiscoverSkillNames(): Promise<((skillsRoot: string) => Promise<string[]>) | null> {
  const mod = await import('../../src/cli/setup.js');
  const candidate = (mod as any).discoverSkillNames;
  return typeof candidate === 'function' ? candidate : null;
}

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

  it('removes project-local skills when run from a nested subdirectory', async () => {
    await fs.mkdir(path.join(tmpHome, '.claude'), { recursive: true });
    await fs.mkdir(path.join(tmpRepo, '.git'), { recursive: true });
    const localSkillsDir = path.join(tmpRepo, '.claude', 'skills', 'gitnexus');
    await fs.mkdir(localSkillsDir, { recursive: true });

    const nestedDir = path.join(tmpRepo, 'packages', 'app');
    await fs.mkdir(nestedDir, { recursive: true });
    process.chdir(nestedDir);

    await setupCommand();

    await expect(fs.stat(localSkillsDir)).rejects.toThrow();
  });

  it('treats .git file as a valid repo marker (worktree/submodule style)', async () => {
    await fs.mkdir(path.join(tmpHome, '.claude'), { recursive: true });
    await fs.writeFile(path.join(tmpRepo, '.git'), 'gitdir: /tmp/fake-worktree.git');
    const localSkillsDir = path.join(tmpRepo, '.claude', 'skills', 'gitnexus');
    await fs.mkdir(localSkillsDir, { recursive: true });

    await setupCommand();

    await expect(fs.stat(localSkillsDir)).rejects.toThrow();
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

describe('discoverSkillNames', () => {
  let tmpDir: string;
  let discoverSkillNames: ((skillsRoot: string) => Promise<string[]>) | null;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gn-discover-skills-'));
    discoverSkillNames = await getDiscoverSkillNames();
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch { /* best-effort */ }
  });

  it('is exported from setup.ts', () => {
    expect(discoverSkillNames, 'setup.ts must export discoverSkillNames()').not.toBeNull();
  });

  it('discovers all skills from the real source directory', async () => {
    if (!discoverSkillNames) return expect.fail('discoverSkillNames not exported');
    const names = await discoverSkillNames(SKILLS_ROOT);
    expect(names.length).toBeGreaterThanOrEqual(7);
    expect(names).toContain('gitnexus-pr-review');
    expect(names).toContain('gitnexus-exploring');
    expect(names).toContain('gitnexus-cli');
  });

  it('only includes gitnexus-* prefixed entries', async () => {
    if (!discoverSkillNames) return expect.fail('discoverSkillNames not exported');
    // Create a mix of valid and invalid entries
    await fs.writeFile(path.join(tmpDir, 'gitnexus-foo.md'), 'skill content');
    await fs.writeFile(path.join(tmpDir, 'README.md'), 'not a skill');
    await fs.writeFile(path.join(tmpDir, 'notes.txt'), 'not a skill');

    const names = await discoverSkillNames(tmpDir);
    expect(names).toEqual(['gitnexus-foo']);
  });

  it('discovers flat .md files', async () => {
    if (!discoverSkillNames) return expect.fail('discoverSkillNames not exported');
    await fs.writeFile(path.join(tmpDir, 'gitnexus-test.md'), 'skill content');

    const names = await discoverSkillNames(tmpDir);
    expect(names).toEqual(['gitnexus-test']);
  });

  it('discovers directory-based skills', async () => {
    if (!discoverSkillNames) return expect.fail('discoverSkillNames not exported');
    const skillDir = path.join(tmpDir, 'gitnexus-test');
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), 'skill content');

    const names = await discoverSkillNames(tmpDir);
    expect(names).toEqual(['gitnexus-test']);
  });

  it('handles mixed layouts (flat + directory)', async () => {
    if (!discoverSkillNames) return expect.fail('discoverSkillNames not exported');
    await fs.writeFile(path.join(tmpDir, 'gitnexus-a.md'), 'flat skill');
    const dirSkill = path.join(tmpDir, 'gitnexus-b');
    await fs.mkdir(dirSkill, { recursive: true });
    await fs.writeFile(path.join(dirSkill, 'SKILL.md'), 'dir skill');

    const names = await discoverSkillNames(tmpDir);
    expect(names.sort()).toEqual(['gitnexus-a', 'gitnexus-b']);
  });

  it('returns empty array for empty directory', async () => {
    if (!discoverSkillNames) return expect.fail('discoverSkillNames not exported');
    const names = await discoverSkillNames(tmpDir);
    expect(names).toEqual([]);
  });

  it('ignores directories without SKILL.md', async () => {
    if (!discoverSkillNames) return expect.fail('discoverSkillNames not exported');
    const brokenSkill = path.join(tmpDir, 'gitnexus-broken');
    await fs.mkdir(brokenSkill, { recursive: true });
    await fs.writeFile(path.join(brokenSkill, 'README.md'), 'not a skill');

    const names = await discoverSkillNames(tmpDir);
    expect(names).toEqual([]);
  });

  it('handles colliding flat+directory entries with same skill name', async () => {
    if (!discoverSkillNames) return expect.fail('discoverSkillNames not exported');
    await fs.writeFile(path.join(tmpDir, 'gitnexus-collision.md'), 'flat skill');
    const dirSkill = path.join(tmpDir, 'gitnexus-collision');
    await fs.mkdir(dirSkill, { recursive: true });
    await fs.writeFile(path.join(dirSkill, 'SKILL.md'), 'dir skill');

    const names = await discoverSkillNames(tmpDir);
    expect(names).toEqual(['gitnexus-collision', 'gitnexus-collision']);
  });

  it('throws when skills root does not exist', async () => {
    if (!discoverSkillNames) return expect.fail('discoverSkillNames not exported');
    const missingRoot = path.join(tmpDir, 'does-not-exist');

    await expect(discoverSkillNames(missingRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('propagates readdir permission failures', async () => {
    if (!discoverSkillNames) return expect.fail('discoverSkillNames not exported');
    const protectedRoot = path.join(tmpDir, 'protected');
    await fs.mkdir(protectedRoot, { recursive: true });

    const originalReaddir = fs.readdir.bind(fs);
    const readdirSpy = vi.spyOn(fs, 'readdir').mockImplementation(async (...args: any[]) => {
      const target = String(args[0]);
      if (target === protectedRoot) {
        const err = new Error('EACCES');
        (err as NodeJS.ErrnoException).code = 'EACCES';
        throw err;
      }
      return originalReaddir(...args as any);
    });

    await expect(discoverSkillNames(protectedRoot)).rejects.toMatchObject({ code: 'EACCES' });
    readdirSpy.mockRestore();
  });

  it('SKILL_NAMES export is lazily populated on first install', async () => {
    vi.resetModules();
    const freshSetup = await import('../../src/cli/setup.js');
    const targetDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gn-lazy-skill-names-'));

    try {
      expect(freshSetup.SKILL_NAMES).toEqual([]);

      const installed = await freshSetup.installSkillsTo(targetDir);
      expect(freshSetup.SKILL_NAMES.length).toBeGreaterThan(0);
      expect(installed.sort()).toEqual([...freshSetup.SKILL_NAMES].sort());
    } finally {
      await fs.rm(targetDir, { recursive: true, force: true });
    }
  });
});
