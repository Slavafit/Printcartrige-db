import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface CollectorRuntime {
  appRoot: string;
  workspaceRoot: string;
}

export function prepareCollectorWorkspace(seedRoot: string, workspaceRoot: string): void {
  copyTree(join(seedRoot, 'scripts'), join(workspaceRoot, 'scripts'), true);
  copyTree(join(seedRoot, 'data'), join(workspaceRoot, 'data'), false);
}

export function prepareWebClient(sourceRoot: string, targetRoot: string): void {
  copyTree(sourceRoot, targetRoot, true);
}

function copyTree(source: string, target: string, overwrite: boolean): void {
  if (!existsSync(source)) return;
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source)) {
    const from = join(source, entry);
    const to = join(target, entry);
    if (statSync(from).isDirectory()) copyTree(from, to, overwrite);
    else if (overwrite || !existsSync(to)) copyFileSync(from, to);
  }
}
