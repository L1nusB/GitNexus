/**
 * Skill File Synchronization — Stub (TDD Red Phase)
 *
 * This module will contain the `planSync` pure function that reads canonical
 * skill files from `gitnexus/skills/` and plans write operations for derived
 * targets. Currently a stub — implementation comes in Phase 3.
 *
 * See docs/skill-sync.md for the full specification.
 */

export interface SyncTarget {
  name: string;
  dir: string;
  skills: string[];
  stripFrontmatter: boolean;
  generatedHeader: boolean;
}

export interface SyncOperation {
  targetPath: string;
  content: string;
  action: 'write' | 'skip';
}

/**
 * Plan synchronization operations from canonical source skills to derived targets.
 *
 * @param sourceDir - Directory containing canonical `gitnexus-*.md` skill files
 * @param targets - Array of sync targets with allowlists and transformation options
 * @param readFile - Async function to read a file's content (injectable for testing)
 * @param listDir - Async function to list directory entries (injectable for testing)
 * @returns Array of planned write/skip operations
 */
export async function planSync(
  _sourceDir: string,
  _targets: SyncTarget[],
  _readFile: (path: string) => Promise<string>,
  _listDir: (dir: string) => Promise<string[]>,
): Promise<SyncOperation[]> {
  // TODO: Implement in Phase 3
  throw new Error('planSync is not yet implemented');
}
