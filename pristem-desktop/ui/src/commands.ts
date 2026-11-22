import type { Mode } from './types';
import type { ActiveView } from './components/LeftRail';
import type { SettingsSectionId } from './components/SettingsPage';
import type { ActivityTab } from './workspace';
import type { PaletteItem } from './components/CommandPalette';
import { t } from './i18n';

export interface Command extends PaletteItem {
  disabled?: boolean;
  /** Tooltip / menu hint when the command cannot run. */
  reason?: string;
  /** Command ids this entry mirrors, used by the menu bar. */
  menu?: boolean;
}

export interface CommandContext {
  sessionId: number | null;
  hasWorkspace: boolean;
  hasActiveFile: boolean;
  canRunActiveFile: boolean;
  newSession: () => void;
  closeSession: () => void;
  restoreSession: () => void;
  setView: (v: ActiveView) => void;
  openOutline: () => void;
  openFolder: () => void;
  newFile: () => void;
  quickOpen: () => void;
  closeWorkspace: () => void;
  save: () => void;
  saveAll: () => void;
  closeEditor: () => void;
  reopenEditor: () => void;
  split: (dir: 'row' | 'column') => void;
  toggleWordWrap: () => void;
  toggleMinimap: () => void;
  openSettings: (section: SettingsSectionId) => void;
  kernel: (req: 'pause' | 'resume' | 'wake') => void;
  switchMode: (m: Mode) => void;
  switchLang: () => void;
  focusTerminal: () => void;
  openActivity: (tab: ActivityTab) => void;
  runActiveFile: () => void;
  runTests: () => void;
  openTaskPicker: () => void;
  stopTask: () => void;
  /** The palette only offers "new terminal" when the shell supports instances. */
  canMultiTerminal?: boolean;
}

/** Editor commands are Monaco's own; the bridge never reimplements them. */
export const editorAction = (
  action: 'undo' | 'redo' | 'find' | 'replace' | 'format' | 'organizeImports'
    | 'definition' | 'references' | 'peekDefinition' | 'rename'
    | 'selectAllOccurrences' | 'foldAll' | 'unfoldAll',
) => window.dispatchEvent(new CustomEvent('pristem:editor-action', { detail: { action } }));

/** One table feeds both the palette and the menu bar (plan 5a). */
export function buildCommands(c: CommandContext): Command[] {
  return [
    { id: 'session.new', label: t('command.session.new'), group: 'session', run: c.newSession },
    { id: 'session.close', label: t('command.session.close'), group: 'session', run: c.closeSession },
    { id: 'session.restore', label: t('command.session.restore'), group: 'session', keys: 'Shift+@+S', run: c.restoreSession },
    { id: 'view.files', label: t('command.view.files'), group: 'view', keys: 'Ctrl+Shift+E', run: () => c.setView('files') },
    { id: 'view.search', label: t('command.view.search'), group: 'view', keys: 'Ctrl+Shift+F', run: () => c.setView('search') },
    { id: 'view.git', label: t('command.view.git'), group: 'view', keys: 'Ctrl+Shift+G', run: () => c.setView('git') },
    { id: 'view.outline', label: t('command.view.outline'), group: 'view', keys: 'Ctrl+Shift+O', run: c.openOutline },
    { id: 'file.openFolder', label: t('command.file.openFolder'), group: 'file', run: c.openFolder },
    { id: 'file.newFile', label: t('command.file.newFile'), group: 'file', run: c.newFile },
    { id: 'file.quickOpen', label: t('command.file.quickOpen'), group: 'file', keys: 'Ctrl+P', run: c.quickOpen },
    { id: 'file.save', label: t('command.file.save'), group: 'file', keys: 'Ctrl+S', disabled: !c.hasActiveFile, run: c.save },
    { id: 'file.saveAll', label: t('command.file.saveAll'), group: 'file', keys: 'Ctrl+Shift+S', disabled: !c.hasWorkspace, run: c.saveAll },
    { id: 'file.closeEditor', label: t('command.file.closeEditor'), group: 'file', keys: 'Ctrl+W', disabled: !c.hasActiveFile, run: c.closeEditor },
    { id: 'file.reopen', label: t('command.file.reopen'), group: 'file', keys: 'Ctrl+Shift+T', run: c.reopenEditor },
    { id: 'file.closeWorkspace', label: t('command.file.closeWorkspace'), group: 'file', disabled: !c.hasWorkspace, run: c.closeWorkspace },
    { id: 'edit.undo', label: t('command.edit.undo'), group: 'edit', keys: 'Ctrl+Z', disabled: !c.hasActiveFile, run: () => editorAction('undo') },
    { id: 'edit.redo', label: t('command.edit.redo'), group: 'edit', keys: 'Ctrl+Y', disabled: !c.hasActiveFile, run: () => editorAction('redo') },
    { id: 'edit.find', label: t('command.edit.find'), group: 'edit', keys: 'Ctrl+F', disabled: !c.hasActiveFile, run: () => editorAction('find') },
    { id: 'edit.replace', label: t('command.edit.replace'), group: 'edit', keys: 'Ctrl+H', disabled: !c.hasActiveFile, run: () => editorAction('replace') },
    { id: 'edit.definition', label: t('command.edit.definition'), group: 'edit', keys: 'F12', disabled: !c.hasActiveFile, run: () => editorAction('definition') },
    { id: 'edit.references', label: t('command.edit.references'), group: 'edit', keys: 'Shift+F12', disabled: !c.hasActiveFile, run: () => editorAction('references') },
    { id: 'edit.peekDefinition', label: t('command.edit.peekDefinition'), group: 'edit', keys: 'Alt+F12', disabled: !c.hasActiveFile, run: () => editorAction('peekDefinition') },
    { id: 'edit.rename', label: t('command.edit.rename'), group: 'edit', keys: 'Shift+F6', disabled: !c.hasActiveFile, run: () => editorAction('rename') },
    { id: 'edit.selectAllOccurrences', label: t('command.edit.selectAllOccurrences'), group: 'edit', keys: 'Ctrl+Shift+L', disabled: !c.hasActiveFile, run: () => editorAction('selectAllOccurrences') },
    { id: 'edit.format', label: t('command.edit.format'), group: 'edit', keys: 'Shift+Alt+F', disabled: !c.hasActiveFile, run: () => editorAction('format') },
    { id: 'edit.organizeImports', label: t('command.edit.organizeImports'), group: 'edit', keys: 'Shift+Alt+O', disabled: !c.hasActiveFile, run: () => editorAction('organizeImports') },
    { id: 'edit.foldAll', label: t('command.edit.foldAll'), group: 'edit', disabled: !c.hasActiveFile, run: () => editorAction('foldAll') },
    { id: 'edit.unfoldAll', label: t('command.edit.unfoldAll'), group: 'edit', disabled: !c.hasActiveFile, run: () => editorAction('unfoldAll') },
    { id: 'view.wordWrap', label: t('command.view.wordWrap'), group: 'view', keys: 'Alt+Z', run: c.toggleWordWrap },
    { id: 'view.minimap', label: t('command.view.minimap'), group: 'view', run: c.toggleMinimap },
    { id: 'split.right', label: t('command.split.right'), group: 'view', keys: 'Ctrl+\\', disabled: !c.hasActiveFile, run: () => c.split('row') },
    { id: 'split.down', label: t('command.split.down'), group: 'view', keys: 'Ctrl+Shift+\\', disabled: !c.hasActiveFile, run: () => c.split('column') },
    { id: 'run.activeFile', label: t('command.run.activeFile'), group: 'run', disabled: !c.canRunActiveFile, reason: t('task.noRunner'), run: c.runActiveFile },
    { id: 'run.tests', label: t('command.run.tests'), group: 'run', disabled: !c.hasWorkspace, run: c.runTests },
    { id: 'run.tasks', label: t('command.run.tasks'), group: 'run', disabled: !c.hasWorkspace, run: c.openTaskPicker },
    { id: 'run.stop', label: t('command.run.stop'), group: 'run', disabled: !c.hasWorkspace, run: c.stopTask },
    { id: 'kernel.pause', label: t('command.kernel.pause'), group: 'kernel', disabled: c.sessionId == null, run: () => c.kernel('pause') },
    { id: 'kernel.resume', label: t('command.kernel.resume'), group: 'kernel', disabled: c.sessionId == null, run: () => c.kernel('resume') },
    { id: 'kernel.wake', label: t('command.kernel.wake'), group: 'kernel', disabled: c.sessionId == null, run: () => c.kernel('wake') },
    { id: 'mode.coding', label: t('command.mode.coding'), group: 'mode', keys: 'F2', run: () => c.switchMode('coding') },
    { id: 'mode.IDE', label: t('command.mode.IDE'), group: 'mode', keys: 'F2', run: () => c.switchMode('IDE') },
    { id: 'mode.helping', label: t('command.mode.helping'), group: 'mode', keys: 'F2', run: () => c.switchMode('helping') },
    { id: 'mode.advisor', label: t('command.mode.advisor'), group: 'mode', keys: 'F2', run: () => c.switchMode('advisor') },
    { id: 'mode.deepsleep', label: t('command.mode.deepsleep'), group: 'mode', keys: 'F2', run: () => c.switchMode('deepsleep') },
    { id: 'mode.goal', label: t('command.mode.goal'), group: 'mode', keys: 'F2', run: () => c.switchMode('goal') },
    { id: 'term.focus', label: t('command.term.focus'), group: 'term', keys: 'Ctrl+`', run: c.focusTerminal },
    ...(c.canMultiTerminal ? [{
      id: 'term.new', label: t('command.term.new'), group: 'term',
      run: () => window.dispatchEvent(new Event('pristem:terminal-new')),
    }] : []),
    { id: 'term.output', label: t('command.term.output'), group: 'term', run: () => c.openActivity('output') },
    { id: 'term.problems', label: t('command.term.problems'), group: 'term', run: () => c.openActivity('problems') },
    { id: 'settings.open', label: t('command.settings.open'), group: 'settings', keys: 'Ctrl+,', run: () => c.openSettings('appearance') },
    { id: 'help.keys', label: t('command.help.keys'), group: 'help', run: () => c.openSettings('keys') },
    { id: 'help.about', label: t('command.help.about'), group: 'help', run: () => c.openSettings('about') },
    { id: 'ui.lang', label: t('command.ui.lang'), group: 'help', run: c.switchLang },
  ];
}

export type MenuEntry = Command | 'separator';

export interface MenuSpec {
  id: string;
  label: string;
  entries: MenuEntry[];
}

const MENU_LAYOUT: { id: string; key: string; ids: string[] }[] = [
  {
    id: 'file', key: 'menu.file',
    ids: ['file.newFile', 'file.save', 'file.saveAll', 'file.quickOpen', 'file.closeEditor', 'file.reopen', '-', 'file.openFolder', 'file.closeWorkspace'],
  },
  {
    id: 'edit', key: 'menu.edit',
    ids: ['edit.undo', 'edit.redo', '-', 'edit.find', 'edit.replace', '-', 'edit.definition', 'edit.references', 'edit.peekDefinition', 'edit.rename', 'edit.selectAllOccurrences', '-', 'edit.format', 'edit.organizeImports', '-', 'edit.foldAll', 'edit.unfoldAll', '-', 'view.wordWrap', 'view.minimap'],
  },
  {
    id: 'view', key: 'menu.view',
    ids: ['view.files', 'view.search', 'view.git', 'view.outline', '-', 'term.focus', 'term.output', 'term.problems', '-', 'split.right', 'split.down', '-', 'settings.open'],
  },
  {
    id: 'run', key: 'menu.run',
    ids: ['run.activeFile', 'run.tests', 'run.tasks', '-', 'run.stop'],
  },
  {
    id: 'help', key: 'menu.help',
    ids: ['help.keys', 'help.about', 'ui.lang'],
  },
];

export function buildMenus(commands: Command[]): MenuSpec[] {
  const byId = new Map(commands.map((c) => [c.id, c]));
  return MENU_LAYOUT.map(({ id, key, ids }) => ({
    id,
    label: t(key),
    entries: ids
      .map((cid) => (cid === '-' ? 'separator' as const : byId.get(cid)))
      .filter((e): e is MenuEntry => !!e),
  }));
}
