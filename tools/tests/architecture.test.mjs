import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, normalize, relative, resolve, sep } from 'node:path';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

const appRoot = resolve('src/app');

function walk(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const path = resolve(directory, entry);
    return statSync(path).isDirectory() ? walk(path) : path.endsWith('.ts') ? [path] : [];
  });
}

function walkUiSources(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const path = resolve(directory, entry);
    if (statSync(path).isDirectory()) return walkUiSources(path);
    return path.endsWith('.ts') || path.endsWith('.html') ? [path] : [];
  });
}

function appTarget(file, specifier) {
  if (!specifier.startsWith('.')) return null;
  const absolute = normalize(resolve(dirname(file), specifier));
  if (!absolute.startsWith(appRoot + sep)) return null;
  return relative(appRoot, absolute).split(sep).join('/');
}

function importsOf(file) {
  const source = readFileSync(file, 'utf8');
  const matches = [
    ...source.matchAll(/from\s+['"]([^'"]+)['"]/g),
    ...source.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g),
  ];
  return matches.map((match) => match[1]);
}

test('application layer dependencies stay directional', () => {
  const violations = [];

  for (const file of walk(appRoot)) {
    const relativeFile = relative(appRoot, file).split(sep).join('/');
    for (const specifier of importsOf(file)) {
      const target = appTarget(file, specifier);
      if (!target) {
        if (relativeFile.startsWith('domain/') && (specifier.startsWith('@angular/') || specifier.startsWith('firebase'))) {
          violations.push(`${relativeFile} -> ${specifier}`);
        }
        continue;
      }

      if (relativeFile.startsWith('domain/') && /^(core|features|pages|layout|shared)\//.test(target)) {
        violations.push(`${relativeFile} -> ${target}`);
      }

      if (relativeFile.startsWith('core/') && /^(features|pages|layout|shared)\//.test(target)) {
        violations.push(`${relativeFile} -> ${target}`);
      }

      if (relativeFile.startsWith('features/') && /^(pages|layout)\//.test(target)) {
        violations.push(`${relativeFile} -> ${target}`);
      }

      if (relativeFile.startsWith('shared/ui/') && /^(core|domain|features|pages|layout|shared\/media|shared\/feedback)\//.test(target)) {
        violations.push(`${relativeFile} -> ${target}`);
      }

      if (relativeFile.startsWith('shared/media/') && /^(features|pages|layout)\//.test(target)) {
        violations.push(`${relativeFile} -> ${target}`);
      }

      if (relativeFile.startsWith('shared/feedback/') && /^(features|pages|layout)\//.test(target)) {
        violations.push(`${relativeFile} -> ${target}`);
      }

      const sourceFeature = relativeFile.match(/^features\/([^/]+)\//)?.[1];
      const targetFeature = target.match(/^features\/([^/]+)\/components\//)?.[1];
      if (sourceFeature && targetFeature && sourceFeature !== targetFeature) {
        violations.push(`${relativeFile} -> ${target}`);
      }
    }
  }

  assert.deepEqual(violations, [], `Architecture violations:\n${violations.join('\n')}`);
});

test('app-specific integrations do not live under shared ui', () => {
  const forbidden = [
    resolve(appRoot, 'shared/integrations'),
    resolve(appRoot, 'shared/ui/image/catalog-image.ts'),
    resolve(appRoot, 'shared/ui/toast/toast-container.ts'),
  ];
  const existing = forbidden.filter((path) => {
    try { return statSync(path).isDirectory() || statSync(path).isFile(); }
    catch { return false; }
  });
  assert.deepEqual(existing, []);
});

test('native dialog lifecycle stays encapsulated by BfDialog', () => {
  const violations = [];
  for (const file of walk(appRoot)) {
    const relativeFile = relative(appRoot, file).split(sep).join('/');
    if (relativeFile === 'shared/ui/dialog/dialog.ts') continue;
    const source = readFileSync(file, 'utf8');
    if (
      source.includes('HTMLDialogElement') ||
      source.includes('.showModal()') ||
      source.includes('.nativeElement.close()')
    ) {
      violations.push(relativeFile);
    }
  }
  assert.deepEqual(violations, []);
});

test('read-sensitive UI never forces whole-store reloads', () => {
  const violations = [];
  for (const file of walk(appRoot)) {
    const relativeFile = relative(appRoot, file).split(sep).join('/');
    if (!/^(pages|features\/[^/]+\/components)\//.test(relativeFile)) continue;
    const source = readFileSync(file, 'utf8');
    if (source.includes('.load(true)')) violations.push(relativeFile);
  }
  assert.deepEqual(violations, [], `Forced full reloads from UI: ${violations.join(', ')}`);
});

test('dashboard stays decoupled from bulk feature stores', () => {
  const file = resolve(appRoot, 'features/dashboard/dashboard.store.ts');
  const imports = importsOf(file);
  const forbidden = imports.filter((specifier) =>
    /features\/(sales|finance|catalog)/.test(normalize(resolve(dirname(file), specifier)).split(sep).join('/'))
  );
  assert.deepEqual(forbidden, []);
});


test('shared controls own select and checkbox rendering', () => {
  const violations = [];
  for (const file of walkUiSources(appRoot)) {
    const relativeFile = relative(appRoot, file).split(sep).join('/');
    const source = readFileSync(file, 'utf8');

    if (/<select\b/i.test(source)) {
      violations.push(`${relativeFile}: native select`);
    }

    if (/type\s*=\s*['"]checkbox['"]/i.test(source) && relativeFile !== 'shared/ui/checkbox/checkbox.html') {
      violations.push(`${relativeFile}: native checkbox`);
    }
  }

  assert.deepEqual(
    violations,
    [],
    `Native form controls outside shared UI:\n${violations.join('\n')}`,
  );
});
