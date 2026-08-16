import hljs from 'highlight.js/lib/core';

import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import go from 'highlight.js/lib/languages/go';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import markdown from 'highlight.js/lib/languages/markdown';
import php from 'highlight.js/lib/languages/php';
import plaintext from 'highlight.js/lib/languages/plaintext';
import python from 'highlight.js/lib/languages/python';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import shell from 'highlight.js/lib/languages/shell';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

/**
 * Registering a subset rather than importing highlight.js wholesale.
 *
 * The full build carries ~190 grammars and dominated the bundle. These cover
 * what a local-model coding workspace actually emits; anything else falls back
 * to plaintext, which is a far better trade than a megabyte of parsers.
 */
const LANGUAGES: Record<string, Parameters<typeof hljs.registerLanguage>[1]> = {
  bash,
  c,
  cpp,
  csharp,
  css,
  diff,
  dockerfile,
  go,
  ini,
  java,
  javascript,
  json,
  kotlin,
  markdown,
  php,
  plaintext,
  python,
  ruby,
  rust,
  shell,
  sql,
  swift,
  typescript,
  xml,
  yaml,
};

for (const [name, definition] of Object.entries(LANGUAGES)) {
  hljs.registerLanguage(name, definition);
}

/** Common aliases that markdown fences use but that are not grammar names. */
const ALIASES: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  sh: 'bash',
  zsh: 'bash',
  console: 'shell',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  golang: 'go',
  yml: 'yaml',
  html: 'xml',
  svg: 'xml',
  toml: 'ini',
  conf: 'ini',
  'c++': 'cpp',
  'c#': 'csharp',
  cs: 'csharp',
  text: 'plaintext',
  txt: 'plaintext',
};

/** Maps a fence language to a registered grammar, or null if unsupported. */
export function resolveLanguage(language?: string): string | null {
  if (!language) return null;
  const key = language.toLowerCase().trim();
  const resolved = ALIASES[key] ?? key;
  return hljs.getLanguage(resolved) ? resolved : null;
}

export { hljs };
