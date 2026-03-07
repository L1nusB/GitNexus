/**
 * Setup Command
 * 
 * One-time global MCP configuration writer.
 * Detects installed AI editors and writes the appropriate MCP config
 * so the GitNexus MCP server is available in all projects.
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { getGlobalDir } from '../storage/repo-manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface SetupResult {
  configured: string[];
  skipped: string[];
  errors: string[];
}

/**
 * The MCP server entry for all editors.
 * On Windows, npx must be invoked via cmd /c since it's a .cmd script.
 */
function getMcpEntry() {
  if (process.platform === 'win32') {
    return {
      command: 'cmd',
      args: ['/c', 'npx', '-y', 'gitnexus@latest', 'mcp'],
    };
  }
  return {
    command: 'npx',
    args: ['-y', 'gitnexus@latest', 'mcp'],
  };
}

/**
 * Merge gitnexus entry into an existing MCP config JSON object.
 * Returns the updated config.
 */
function mergeMcpConfig(existing: any): any {
  if (!existing || typeof existing !== 'object') {
    existing = {};
  }
  if (!existing.mcpServers || typeof existing.mcpServers !== 'object') {
    existing.mcpServers = {};
  }
  existing.mcpServers.gitnexus = getMcpEntry();
  return existing;
}

/**
 * Try to read a JSON file, returning null if it doesn't exist or is invalid.
 */
async function readJsonFile(filePath: string): Promise<any | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Write JSON to a file, creating parent directories if needed.
 */
async function writeJsonFile(filePath: string, data: any): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

/**
 * Check if a directory exists
 */
async function dirExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

// ─── Editor-specific setup ─────────────────────────────────────────

async function setupCursor(result: SetupResult): Promise<void> {
  const cursorDir = path.join(os.homedir(), '.cursor');
  if (!(await dirExists(cursorDir))) {
    result.skipped.push('Cursor (not installed)');
    return;
  }

  const mcpPath = path.join(cursorDir, 'mcp.json');
  try {
    const existing = await readJsonFile(mcpPath);
    const updated = mergeMcpConfig(existing);
    await writeJsonFile(mcpPath, updated);
    result.configured.push('Cursor');
  } catch (err: any) {
    result.errors.push(`Cursor: ${err.message}`);
  }
}

async function setupClaudeCode(result: SetupResult): Promise<void> {
  const claudeDir = path.join(os.homedir(), '.claude');
  const hasClaude = await dirExists(claudeDir);

  if (!hasClaude) {
    result.skipped.push('Claude Code (not installed)');
    return;
  }

  // Claude Code uses a JSON settings file at ~/.claude.json or claude mcp add
  console.log('');
  console.log('  Claude Code detected. Run this command to add GitNexus MCP:');
  console.log('');
  console.log('    claude mcp add gitnexus -- npx -y gitnexus mcp');
  console.log('');
  result.configured.push('Claude Code (MCP manual step printed)');
}

/**
 * Install GitNexus skills to ~/.claude/skills/ for Claude Code.
 */
async function installClaudeCodeSkills(result: SetupResult): Promise<void> {
  const claudeDir = path.join(os.homedir(), '.claude');
  if (!(await dirExists(claudeDir))) return;

  const skillsDir = path.join(claudeDir, 'skills');
  try {
    const installed = await installSkillsTo(skillsDir);
    if (installed.length > 0) {
      result.configured.push(`Claude Code skills (${installed.length} skills → ~/.claude/skills/)`);
    }
  } catch (err: any) {
    result.errors.push(`Claude Code skills: ${err.message}`);
  }
}

/**
 * Install GitNexus hooks to ~/.claude/settings.json for Claude Code.
 * Merges hook config without overwriting existing hooks.
 */
async function installClaudeCodeHooks(result: SetupResult): Promise<void> {
  const claudeDir = path.join(os.homedir(), '.claude');
  if (!(await dirExists(claudeDir))) return;

  const settingsPath = path.join(claudeDir, 'settings.json');

  // Source hooks bundled within the gitnexus package (hooks/claude/)
  const pluginHooksPath = path.join(__dirname, '..', '..', 'hooks', 'claude');

  // Copy unified hook script to ~/.claude/hooks/gitnexus/
  const destHooksDir = path.join(claudeDir, 'hooks', 'gitnexus');

  try {
    await fs.mkdir(destHooksDir, { recursive: true });

    const src = path.join(pluginHooksPath, 'gitnexus-hook.cjs');
    const dest = path.join(destHooksDir, 'gitnexus-hook.cjs');
    try {
      let content = await fs.readFile(src, 'utf-8');
      // Inject resolved CLI path so the copied hook can find the CLI
      // even when it's no longer inside the npm package tree
      const resolvedCli = path.join(__dirname, '..', 'cli', 'index.js');
      const normalizedCli = path.resolve(resolvedCli).replace(/\\/g, '/');
      const jsonCli = JSON.stringify(normalizedCli);
      content = content.replace(
        "let cliPath = path.resolve(__dirname, '..', '..', 'dist', 'cli', 'index.js');",
        `let cliPath = ${jsonCli};`
      );
      await fs.writeFile(dest, content, 'utf-8');
    } catch {
      // Script not found in source — skip
    }

    const hookPath = path.join(destHooksDir, 'gitnexus-hook.cjs').replace(/\\/g, '/');
    const hookCmd = `node "${hookPath.replace(/"/g, '\\"')}"`;

    // Merge hook config into ~/.claude/settings.json
    const existing = await readJsonFile(settingsPath) || {};
    if (!existing.hooks) existing.hooks = {};

    // NOTE: SessionStart hooks are broken on Windows (Claude Code bug #23576).
    // Session context is delivered via CLAUDE.md / skills instead.

    // Helper: add a hook entry if one with 'gitnexus-hook' isn't already registered
    interface HookEntry { hooks?: Array<{ command?: string }> }
    function ensureHookEntry(
      eventName: string,
      matcher: string,
      timeout: number,
      statusMessage: string,
    ) {
      if (!existing.hooks[eventName]) existing.hooks[eventName] = [];
      const hasHook = existing.hooks[eventName].some(
        (h: HookEntry) => h.hooks?.some(hh => hh.command?.includes('gitnexus-hook'))
      );
      if (!hasHook) {
        existing.hooks[eventName].push({
          matcher,
          hooks: [{ type: 'command', command: hookCmd, timeout, statusMessage }],
        });
      }
    }

    ensureHookEntry('PreToolUse', 'Grep|Glob|Bash', 10, 'Enriching with GitNexus graph context...');
    ensureHookEntry('PostToolUse', 'Bash', 10, 'Checking GitNexus index freshness...');

    await writeJsonFile(settingsPath, existing);
    result.configured.push('Claude Code hooks (PreToolUse, PostToolUse)');
  } catch (err: any) {
    result.errors.push(`Claude Code hooks: ${err.message}`);
  }
}

async function setupOpenCode(result: SetupResult): Promise<void> {
  const opencodeDir = path.join(os.homedir(), '.config', 'opencode');
  if (!(await dirExists(opencodeDir))) {
    result.skipped.push('OpenCode (not installed)');
    return;
  }

  const configPath = path.join(opencodeDir, 'config.json');
  try {
    const existing = await readJsonFile(configPath);
    const config = existing || {};
    if (!config.mcp) config.mcp = {};
    config.mcp.gitnexus = getMcpEntry();
    await writeJsonFile(configPath, config);
    result.configured.push('OpenCode');
  } catch (err: any) {
    result.errors.push(`OpenCode: ${err.message}`);
  }
}

// ─── Skill Installation ───────────────────────────────────────────

/**
 * Discover skill names from a skills source directory.
 *
 * Scans for two layouts:
 *   - Flat file:  gitnexus-{name}.md         → skill name "gitnexus-{name}"
 *   - Directory:  gitnexus-{name}/SKILL.md   → skill name "gitnexus-{name}"
 *
 * Only entries prefixed with "gitnexus-" are included.
 * Directories without a SKILL.md are ignored.
 */
export async function discoverSkillNames(skillsRoot: string): Promise<string[]> {
  const entries = await fs.readdir(skillsRoot, { withFileTypes: true });
  const names: string[] = [];

  for (const entry of entries) {
    if (!entry.name.startsWith('gitnexus-')) continue;

    if (entry.isFile() && entry.name.endsWith('.md')) {
      names.push(entry.name.replace(/\.md$/, ''));
    } else if (entry.isDirectory()) {
      try {
        await fs.access(path.join(skillsRoot, entry.name, 'SKILL.md'));
        names.push(entry.name);
      } catch { /* no SKILL.md — skip */ }
    }
  }

  return names.sort();
}

/** Default skills source directory (resolved relative to this file). */
const DEFAULT_SKILLS_ROOT = path.join(__dirname, '..', '..', 'skills');

/**
 * Skill names discovered from the skills/ source directory.
 * Computed lazily on first access; exported for test compatibility.
 */
export let SKILL_NAMES: string[] = [];
let _skillNamesResolved = false;

async function ensureSkillNames(): Promise<string[]> {
  if (!_skillNamesResolved) {
    SKILL_NAMES = await discoverSkillNames(DEFAULT_SKILLS_ROOT);
    _skillNamesResolved = true;
  }
  return SKILL_NAMES;
}

/**
 * Install GitNexus skills to a target directory.
 * Each skill is installed as {targetDir}/gitnexus-{skillName}/SKILL.md
 * following the Agent Skills standard (both Cursor and Claude Code).
 *
 * Supports two source layouts:
 *   - Flat file:  skills/{name}.md           → copied as SKILL.md
 *   - Directory:  skills/{name}/SKILL.md     → copied recursively (includes references/, etc.)
 */
export async function installSkillsTo(targetDir: string): Promise<string[]> {
  const installed: string[] = [];
  const skillsRoot = DEFAULT_SKILLS_ROOT;
  const skillNames = await ensureSkillNames();

  for (const skillName of skillNames) {
    const skillDir = path.join(targetDir, skillName);

    try {
      // Try directory-based skill first (skills/{name}/SKILL.md)
      const dirSource = path.join(skillsRoot, skillName);

      let isDirectory = false;
      try {
        const stat = await fs.stat(dirSource);
        isDirectory = stat.isDirectory();
      } catch { /* not a directory */ }

      if (isDirectory) {
        await copyDirRecursive(dirSource, skillDir);
        installed.push(skillName);
      } else {
        // Fall back to flat file (skills/{name}.md)
        const flatSource = path.join(skillsRoot, `${skillName}.md`);
        const content = await fs.readFile(flatSource, 'utf-8');
        await fs.mkdir(skillDir, { recursive: true });
        await fs.writeFile(path.join(skillDir, 'SKILL.md'), content, 'utf-8');
        installed.push(skillName);
      }
    } catch (err: any) {
      if (err?.code === 'ENOENT') continue; // Source skill not found — skip
      throw err; // Real I/O errors should propagate
    }
  }

  return installed;
}

/**
 * Recursively copy a directory tree.
 */
async function copyDirRecursive(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDirRecursive(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

/**
 * Install global Cursor skills to ~/.cursor/skills/gitnexus/
 */
async function installCursorSkills(result: SetupResult): Promise<void> {
  const cursorDir = path.join(os.homedir(), '.cursor');
  if (!(await dirExists(cursorDir))) return;
  
  const skillsDir = path.join(cursorDir, 'skills');
  try {
    const installed = await installSkillsTo(skillsDir);
    if (installed.length > 0) {
      result.configured.push(`Cursor skills (${installed.length} skills → ~/.cursor/skills/)`);
    }
  } catch (err: any) {
    result.errors.push(`Cursor skills: ${err.message}`);
  }
}

/**
 * Install global OpenCode skills to ~/.config/opencode/skill/gitnexus/
 */
async function installOpenCodeSkills(result: SetupResult): Promise<void> {
  const opencodeDir = path.join(os.homedir(), '.config', 'opencode');
  if (!(await dirExists(opencodeDir))) return;
  
  const skillsDir = path.join(opencodeDir, 'skill');
  try {
    const installed = await installSkillsTo(skillsDir);
    if (installed.length > 0) {
      result.configured.push(`OpenCode skills (${installed.length} skills → ~/.config/opencode/skill/)`);
    }
  } catch (err: any) {
    result.errors.push(`OpenCode skills: ${err.message}`);
  }
}

// ─── Project-local skill cleanup ───────────────────────────────────

/**
 * Find the nearest git repository root by walking upward and checking for
 * a .git marker (directory for standard repos, file for worktrees/submodules).
 */
async function findRepoRoot(startPath: string): Promise<string | null> {
  let current = path.resolve(startPath);
  const root = path.parse(current).root;

  while (true) {
    const gitMarker = path.join(current, '.git');
    try {
      const stat = await fs.stat(gitMarker);
      if (stat.isDirectory() || stat.isFile()) {
        return current;
      }
    } catch {
      // Keep walking up
    }

    if (current === root) return null;
    current = path.dirname(current);
  }
}

/**
 * Remove stale project-local skills left by previous `analyze` runs.
 * Cleans up at repo root and supports both .git directories and files.
 */
async function cleanupProjectLocalSkills(result: SetupResult): Promise<void> {
  const repoRoot = await findRepoRoot(process.cwd());
  if (!repoRoot) return; // Not inside a git repo

  const localSkillsDir = path.join(repoRoot, '.claude', 'skills', 'gitnexus');
  try {
    const stat = await fs.stat(localSkillsDir);
    if (!stat.isDirectory()) return;
  } catch {
    return; // No project-local skills
  }

  try {
    await fs.rm(localSkillsDir, { recursive: true, force: true });
    result.configured.push('Removed project-local skills (now installed globally)');
  } catch (err: any) {
    result.errors.push(`Project-local skill cleanup: ${err.message}`);
  }
}

// ─── Main command ──────────────────────────────────────────────────

export const setupCommand = async () => {
  console.log('');
  console.log('  GitNexus Setup');
  console.log('  ==============');
  console.log('');

  // Ensure global directory exists
  const globalDir = getGlobalDir();
  await fs.mkdir(globalDir, { recursive: true });

  const result: SetupResult = {
    configured: [],
    skipped: [],
    errors: [],
  };

  // Detect and configure each editor's MCP
  await setupCursor(result);
  await setupClaudeCode(result);
  await setupOpenCode(result);
  
  // Install global skills for platforms that support them
  await installClaudeCodeSkills(result);
  await installClaudeCodeHooks(result);
  await installCursorSkills(result);
  await installOpenCodeSkills(result);

  // Clean up stale project-local skills left by previous `analyze` runs,
  // but only if at least one global skill install succeeded (don't remove
  // local skills without replacement).
  const globalSkillsInstalled = result.configured.some(c => c.includes('skills ('));
  if (globalSkillsInstalled) {
    await cleanupProjectLocalSkills(result);
  }

  // Print results
  if (result.configured.length > 0) {
    console.log('  Configured:');
    for (const name of result.configured) {
      console.log(`    + ${name}`);
    }
  }

  if (result.skipped.length > 0) {
    console.log('');
    console.log('  Skipped:');
    for (const name of result.skipped) {
      console.log(`    - ${name}`);
    }
  }

  if (result.errors.length > 0) {
    console.log('');
    console.log('  Errors:');
    for (const err of result.errors) {
      console.log(`    ! ${err}`);
    }
  }

  console.log('');
  console.log('  Summary:');
  console.log(`    MCP configured for: ${result.configured.filter(c => !c.includes('skills')).join(', ') || 'none'}`);
  console.log(`    Skills installed to: ${result.configured.filter(c => c.includes('skills')).length > 0 ? result.configured.filter(c => c.includes('skills')).join(', ') : 'none'}`);
  console.log('');
  console.log('  Next steps:');
  console.log('    1. cd into any git repo');
  console.log('    2. Run: gitnexus analyze');
  console.log('    3. Open the repo in your editor — MCP is ready!');
  console.log('');
};
