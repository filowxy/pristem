import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

// Vite worker wiring — required for a file://-less, fully bundled Monaco.
(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
  getWorker(_moduleId: string, label: string) {
    if (label === 'json') return new JsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker();
    if (label === 'typescript' || label === 'javascript') return new TsWorker();
    return new EditorWorker();
  },
};

// Colour hierarchy comes from the syntax, not from the chrome. The chrome is
// pure black + grey; the code surface is the one lit, saturated place.
monaco.editor.defineTheme('pristem-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: '', foreground: 'F5F5F5', background: '000000' },
    { token: 'comment', foreground: '5F6672', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'C792EA', fontStyle: 'bold' },
    { token: 'keyword.control', foreground: 'C792EA', fontStyle: 'bold' },
    { token: 'string', foreground: 'A9E08F' },
    { token: 'string.escape', foreground: 'F2A65A' },
    { token: 'number', foreground: 'F2A65A' },
    { token: 'constant', foreground: 'F2A65A' },
    { token: 'type', foreground: 'F4D06F', fontStyle: 'bold' },
    { token: 'type.identifier', foreground: 'F4D06F' },
    { token: 'identifier', foreground: 'F5F5F5' },
    { token: 'function', foreground: '7FB2FF' },
    { token: 'variable', foreground: '8FE3E0' },
    { token: 'variable.predefined', foreground: '8FE3E0' },
    { token: 'delimiter', foreground: '8F9BB3' },
    { token: 'tag', foreground: 'FF8A8A' },
    { token: 'attribute.name', foreground: 'F4D06F' },
    { token: 'attribute.value', foreground: 'A9E08F' },
    { token: 'metatag', foreground: 'C792EA' },
  ],
  colors: {
    'editor.background': '#000000',
    'editor.foreground': '#F5F5F5',
    'editorLineNumber.foreground': '#4A4A4A',
    'editorLineNumber.activeForeground': '#7FB2FF',
    'editor.lineHighlightBackground': '#0A0A0A',
    'editor.selectionBackground': '#7FB2FF30',
    'editorCursor.foreground': '#FFFFFF',
    'editorIndentGuide.background1': '#1A1A1A',
    'editorBracketMatch.background': '#C792EA26',
    'editorBracketMatch.border': '#C792EA88',
    'editorGutter.background': '#000000',
    'editorWidget.background': '#111111',
    'editorWidget.border': '#333333',
    'editorStickyScroll.background': '#000000',
    'editorError.foreground': '#FF6B6B',
    'editorWarning.foreground': '#F2C879',
    'editorInfo.foreground': '#7FB2FF',
    'findMatchBackground': '#F2A65A44',
    'findMatchHighlightBackground': '#F2A65A22',
    'scrollbarSlider.background': '#38383866',
    'scrollbarSlider.hoverBackground': '#5A5A5A88',
    'minimap.background': '#000000',
  },
});

// Webfonts can land after Monaco measured glyph widths; stale widths make clicks land in
// the wrong column (the caret looks offset). Re-measure once the fonts are ready.
if (typeof document !== 'undefined' && document.fonts) {
  void document.fonts.ready.then(() => monaco.editor.remeasureFonts());
}

export function languageFor(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    rs: 'rust',
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    json: 'json',
    md: 'markdown',
    css: 'css',
    scss: 'scss',
    html: 'html',
    toml: 'ini',
    yaml: 'yaml',
    yml: 'yaml',
    py: 'python',
    sh: 'shell',
    sql: 'sql',
  };
  return map[ext] ?? 'plaintext';
}

export { monaco };
