import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { generateAIContextFiles } from '../../src/cli/ai-context.js';

describe('generateAIContextFiles', () => {
  let tmpDir: string;
  let storagePath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gn-ai-ctx-test-'));
    storagePath = path.join(tmpDir, '.gitnexus');
    await fs.mkdir(storagePath, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch { /* best-effort */ }
  });

  it('generates context files', async () => {
    const stats = {
      nodes: 100,
      edges: 200,
      processes: 10,
    };

    const result = await generateAIContextFiles(tmpDir, storagePath, 'TestProject', stats);
    expect(result.files).toBeDefined();
    expect(result.files.length).toBeGreaterThan(0);
  });

  it('creates or updates CLAUDE.md with GitNexus section', async () => {
    const stats = { nodes: 50, edges: 100, processes: 5 };
    await generateAIContextFiles(tmpDir, storagePath, 'TestProject', stats);

    const claudeMdPath = path.join(tmpDir, 'CLAUDE.md');
    const content = await fs.readFile(claudeMdPath, 'utf-8');
    expect(content).toContain('gitnexus:start');
    expect(content).toContain('gitnexus:end');
    expect(content).toContain('TestProject');
  });

  it('handles empty stats', async () => {
    const stats = {};
    const result = await generateAIContextFiles(tmpDir, storagePath, 'EmptyProject', stats);
    expect(result.files).toBeDefined();
  });

  it('updates existing CLAUDE.md without duplicating', async () => {
    const firstStats = { nodes: 10, edges: 20, processes: 2 };
    const secondStats = { nodes: 11, edges: 22, processes: 3 };

    // Run twice
    await generateAIContextFiles(tmpDir, storagePath, 'TestProject', firstStats);
    await generateAIContextFiles(tmpDir, storagePath, 'TestProject', secondStats);

    const claudeMdPath = path.join(tmpDir, 'CLAUDE.md');
    const content = await fs.readFile(claudeMdPath, 'utf-8');

    // Should only have one gitnexus section
    const starts = (content.match(/gitnexus:start/g) || []).length;
    expect(starts).toBe(1);
    expect(content).toContain('11 symbols');
    expect(content).not.toContain('10 symbols');
  });

  it('does NOT install skills after refactor', async () => {
    const stats = { nodes: 10 };
    await generateAIContextFiles(tmpDir, storagePath, 'TestProject', stats);

    const skillsDir = path.join(tmpDir, '.claude', 'skills', 'gitnexus');
    await expect(fs.stat(skillsDir)).rejects.toThrow();
  });

  it('return value does not mention skills after refactor', async () => {
    const stats = { nodes: 10 };
    const result = await generateAIContextFiles(tmpDir, storagePath, 'TestProject', stats);
    const hasSkillEntry = result.files.some(f => f.includes('skills'));
    expect(hasSkillEntry).toBe(false);
  });

  // ── Regression guards (should pass before AND after refactor) ────

  it('generates CLAUDE.md with dynamic stats', async () => {
    const stats = { nodes: 42, edges: 84, processes: 7 };
    await generateAIContextFiles(tmpDir, storagePath, 'StatsProject', stats);

    const content = await fs.readFile(path.join(tmpDir, 'CLAUDE.md'), 'utf-8');
    expect(content).toContain('42 symbols');
    expect(content).toContain('84 relationships');
    expect(content).toContain('7 execution flows');
  });

  it('generates AGENTS.md alongside CLAUDE.md', async () => {
    const stats = { nodes: 10, edges: 20, processes: 3 };
    await generateAIContextFiles(tmpDir, storagePath, 'TestProject', stats);

    const agentsPath = path.join(tmpDir, 'AGENTS.md');
    const content = await fs.readFile(agentsPath, 'utf-8');
    expect(content).toContain('gitnexus:start');
    expect(content).toContain('gitnexus:end');
  });

  it('preserves existing non-GitNexus content in CLAUDE.md', async () => {
    // Pre-create CLAUDE.md with custom content
    const claudePath = path.join(tmpDir, 'CLAUDE.md');
    await fs.writeFile(claudePath, '# My Custom Instructions\n\nDo not remove this.\n', 'utf-8');

    const stats = { nodes: 10 };
    await generateAIContextFiles(tmpDir, storagePath, 'TestProject', stats);

    const content = await fs.readFile(claudePath, 'utf-8');
    expect(content).toContain('My Custom Instructions');
    expect(content).toContain('Do not remove this.');
    expect(content).toContain('gitnexus:start');
  });

  it('existing CLAUDE.md with gitnexus section but no skills dir works', async () => {
    // Pre-create CLAUDE.md with an existing gitnexus section
    const claudePath = path.join(tmpDir, 'CLAUDE.md');
    await fs.writeFile(claudePath, '<!-- gitnexus:start -->\nold content\n<!-- gitnexus:end -->\n', 'utf-8');

    const stats = { nodes: 99 };
    await generateAIContextFiles(tmpDir, storagePath, 'UpdatedProject', stats);

    const content = await fs.readFile(claudePath, 'utf-8');
    // Old content replaced
    expect(content).not.toContain('old content');
    // New content present
    expect(content).toContain('99 symbols');
    // Still only one section
    const starts = (content.match(/gitnexus:start/g) || []).length;
    expect(starts).toBe(1);
    await expect(fs.stat(path.join(tmpDir, '.claude', 'skills', 'gitnexus'))).rejects.toThrow();
  });
});
