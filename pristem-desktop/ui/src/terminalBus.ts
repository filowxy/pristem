import { GIT_INSTANCE } from './types';

export interface OutputLine {
  /** Terminal instance the line belongs to (0 = the first user instance). */
  instance: number;
  source: 'shell' | 'kernel';
  text: string;
}

const OUTPUT: OutputLine[] = [];
const listeners = new Set<() => void>();

/** Silent windows: while an instance is silent nothing reaches its terminal. */
const silent = new Set<number>();

export function isSilent(instance: number): boolean {
  return silent.has(instance);
}
export function beginSilent(instance: number): void { silent.add(instance); }
export function endSilent(instance: number): void { silent.delete(instance); }

/** The Git panel owns a reserved channel so it never pollutes a user terminal. */
export const GIT_CHANNEL = GIT_INSTANCE;

export function recordOutput(line: OutputLine): void {
  OUTPUT.push(line);
  while (OUTPUT.length > 200) OUTPUT.shift();
  listeners.forEach((l) => l());
}

export function readOutput(): OutputLine[] {
  return OUTPUT.slice();
}

export function subscribeOutput(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
