import type { FileEntry } from './types';
import { t } from './i18n';

export interface Task {
  id: string;
  label: string;
  command: string;
  source: 'test' | 'script' | 'file';
}

const quote = (p: string) => (/\s/.test(p) ? `"${p}"` : p);

const rootNames = (files: FileEntry[]) =>
  new Set(files.filter((f) => !f.dir && !f.path.includes('/')).map((f) => f.name.toLowerCase()));

/** Test-command detection (moved out of App so the Run menu and the tree share it). */
export function testCommand(files: FileEntry[]): string | null {
  const names = rootNames(files);
  const nested = (suffix: string) => files.find((f) => f.path.toLowerCase().endsWith(suffix))?.path;
  const cargo = nested('/cargo.toml');
  const pkg = nested('/package.json');
  if (names.has('pnpm-lock.yaml')) return 'pnpm test';
  if (names.has('package.json')) return 'npm test';
  if (names.has('cargo.toml')) return 'cargo test';
  if (names.has('gradlew.bat') || names.has('gradlew')) return 'gradlew.bat test';
  if (names.has('pom.xml')) return 'mvn -q test';
  if (names.has('build.gradle') || names.has('build.gradle.kts')) return 'gradle test';
  if (names.has('pyproject.toml') || names.has('pytest.ini')) return 'python -m pytest';
  if (cargo) return `cargo test --manifest-path ${quote(cargo)}`;
  if (pkg) return `npm --prefix ${quote(pkg.replace(/\/[^/]+$/, ''))} test`;
  return null;
}

/** Extension → runner. `.rs` also needs a Cargo.toml somewhere in the tree. */
export function activeFileTask(files: FileEntry[], activePath: string | null): Task | null {
  if (!activePath) return null;
  const p = quote(activePath);
  const runner = (command: string): Task => ({
    id: 'run.file', label: t('task.activeFile'), command, source: 'file',
  });
  if (activePath.endsWith('.py')) return runner(`python ${p}`);
  if (activePath.endsWith('.js') || activePath.endsWith('.mjs')) return runner(`node ${p}`);
  if (activePath.endsWith('.ps1')) return runner(`powershell -NoProfile -File ${p}`);
  if (activePath.endsWith('.sh')) return runner(`bash ${p}`);
  if (activePath.endsWith('.rs') && files.some((f) => f.name.toLowerCase() === 'cargo.toml')) {
    return runner('cargo run');
  }
  return null;
}

/**
 * The Run menu's task list: the detected test command first, then the root
 * package.json scripts (≤20 total), then "run active file".
 * ponytail: root package.json only — monorepo script discovery waits for a
 * real need.
 */
export function detectTasks(
  files: FileEntry[],
  packageJson?: string,
  activePath: string | null = null,
): Task[] {
  const out: Task[] = [];
  const test = testCommand(files);
  if (test) out.push({ id: 'run.tests', label: t('tree.runTests'), command: test, source: 'test' });

  if (packageJson) {
    try {
      const pkg = JSON.parse(packageJson) as { scripts?: Record<string, string> };
      const pm = rootNames(files).has('pnpm-lock.yaml') ? 'pnpm' : 'npm';
      for (const name of Object.keys(pkg.scripts ?? {})) {
        if (out.length >= 20) break;
        if (name === 'test' && test) continue;
        out.push({ id: `script.${name}`, label: `${pm} run ${name}`, command: `${pm} run ${name}`, source: 'script' });
      }
    } catch { /* malformed package.json — no script tasks */ }
  }

  const file = activeFileTask(files, activePath);
  if (file) out.push(file);
  return out;
}
