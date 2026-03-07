import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

/**
 * Contract tests for analyze stale-skills notice.
 * These are intentionally active pre-refactor acceptance tests:
 * they should fail until analyze exports and uses checkStaleProjectSkills().
 */

async function getCheckStaleProjectSkills(): Promise<(repoPath: string) => Promise<boolean>> {
  const analyzeModule = await import('../../src/cli/analyze.js');
  const candidate = (analyzeModule as any).checkStaleProjectSkills;
  expect(
    typeof candidate,
    'analyze.ts must export checkStaleProjectSkills(repoPath) for unit testing',
  ).toBe('function');
  return candidate as (repoPath: string) => Promise<boolean>;
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

    const checkStaleProjectSkills = await getCheckStaleProjectSkills();
    const detected = await checkStaleProjectSkills(tmpDir);

    expect(detected).toBe(true);
    const notice = consoleOutput.find(line => line.includes('no longer installed by analyze'));
    expect(notice).toBeDefined();
  });

  it('prints no notice when .claude/skills/gitnexus/ does not exist', async () => {
    const checkStaleProjectSkills = await getCheckStaleProjectSkills();
    const detected = await checkStaleProjectSkills(tmpDir);

    expect(detected).toBe(false);
    const notice = consoleOutput.find(line => line.includes('no longer installed by analyze'));
    expect(notice).toBeUndefined();
  });

  it('does NOT delete the directory — only warns', async () => {
    const skillsDir = path.join(tmpDir, '.claude', 'skills', 'gitnexus');
    await fs.mkdir(skillsDir, { recursive: true });

    const checkStaleProjectSkills = await getCheckStaleProjectSkills();
    await checkStaleProjectSkills(tmpDir);

    // Directory must still exist
    const stat = await fs.stat(skillsDir);
    expect(stat.isDirectory()).toBe(true);
  });

  it('handles .claude dir existing without skills/gitnexus/', async () => {
    // .claude exists but no skills subdirectory
    await fs.mkdir(path.join(tmpDir, '.claude'), { recursive: true });

    const checkStaleProjectSkills = await getCheckStaleProjectSkills();
    const detected = await checkStaleProjectSkills(tmpDir);
    expect(detected).toBe(false);
  });

  it('prints stale-skills notice on analyze early return (Already up to date)', async () => {
    // Real git repo so analyzeCommand can resolve repo + commit
    execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
    await fs.writeFile(path.join(tmpDir, 'README.md'), 'hello\n', 'utf-8');
    execSync('git add README.md', { cwd: tmpDir, stdio: 'ignore' });
    execSync('git -c user.name="Test" -c user.email="test@example.com" commit -m "init"', {
      cwd: tmpDir,
      stdio: 'ignore',
    });

    const commit = execSync('git rev-parse HEAD', { cwd: tmpDir }).toString().trim();

    // Mark index metadata as current so analyze exits early
    const storagePath = path.join(tmpDir, '.gitnexus');
    await fs.mkdir(storagePath, { recursive: true });
    await fs.writeFile(
      path.join(storagePath, 'meta.json'),
      JSON.stringify({ repoPath: tmpDir, lastCommit: commit, indexedAt: new Date().toISOString() }, null, 2),
      'utf-8',
    );

    // Leave stale project-local skills in place
    await fs.mkdir(path.join(tmpDir, '.claude', 'skills', 'gitnexus'), { recursive: true });

    const originalNodeOptions = process.env.NODE_OPTIONS;
    process.env.NODE_OPTIONS = `${originalNodeOptions || ''} --max-old-space-size=8192`.trim();
    try {
      const analyzeModule = await import('../../src/cli/analyze.js');
      const analyzeCommand = (analyzeModule as any).analyzeCommand as (inputPath?: string) => Promise<void>;
      await analyzeCommand(tmpDir);
    } finally {
      process.env.NODE_OPTIONS = originalNodeOptions;
    }

    const upToDate = consoleOutput.find(line => line.includes('Already up to date'));
    const notice = consoleOutput.find(line => line.includes('no longer installed by analyze'));
    expect(upToDate).toBeDefined();
    expect(notice).toBeDefined();
  });
});
