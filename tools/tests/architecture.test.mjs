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


test('shared image upload owns native file input rendering', () => {
  const violations = [];
  for (const file of walkUiSources(appRoot)) {
    const relativeFile = relative(appRoot, file).split(sep).join('/');
    if (relativeFile === 'shared/ui/image-upload/image-upload.html') continue;

    const source = readFileSync(file, 'utf8');
    if (/type\s*=\s*['"]file['"]/i.test(source)) {
      violations.push(relativeFile);
    }
  }

  assert.deepEqual(
    violations,
    [],
    `Native file inputs outside shared image upload:\n${violations.join('\n')}`,
  );
});

test('floating close styling preserves button touch size and aligned dialog footer', () => {
  const styles = readFileSync(resolve('src/styles.scss'), 'utf8');
  const drive = readFileSync(resolve(appRoot, 'features/google-drive/components/drive-connection-banner.ts'), 'utf8');
  assert.match(styles, /\.bf-floating-close\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px;/s);
  assert.match(styles, /\.bf-floating-close::before\s*\{/);
  assert.match(styles, /\.bf-floating-close:focus-visible::before\s*\{/);
  assert.match(styles, /\.bf-dialog-header,\s*\.bf-dialog-footer\s*\{[^}]*padding:\s*19px 21px;/s);
  assert.match(styles, /\.bf-dialog-header\s*\{\s*padding-right:\s*54px;/);
  assert.match(styles, /\.bf-dialog-footer\s*\{[^}]*justify-content:\s*flex-end;/s);
  assert.match(styles, /top: -19px;\s*right: -20px;\s*display: grid;/);
  assert.match(drive, /--bf-close-inset:6px;--bf-close-icon-size:14px;top:-19px;right:-20px/);
});

// Dialog geometry regression: prevent the partially clipped X on compact screens.
test('close buttons remain within viewport on compact dialogs and Drive notice', () => {
  const styles = readFileSync(resolve('src/styles.scss'), 'utf8');
  const sale = readFileSync(resolve(appRoot, 'features/sales/components/sale-editor/sale-editor.scss'), 'utf8');
  const drive = readFileSync(resolve(appRoot, 'features/google-drive/components/drive-connection-banner.ts'), 'utf8');
  const confirm = readFileSync(resolve(appRoot, 'shared/ui/confirm-dialog/confirm-dialog.scss'), 'utf8');

  const responsiveClose = styles.slice(styles.indexOf('/* Compact dialogs keep'), styles.indexOf('@media (prefers-reduced-motion: reduce)', styles.indexOf('/* Compact dialogs keep')));
  assert.match(responsiveClose, /@media \(max-width: 980px\)/);
  assert.match(responsiveClose, /\.bf-dialog \.bf-floating-close,\s*\.sale-dialog \.bf-floating-close\s*\{\s*top: 10px;\s*right: 12px;/);
  assert.match(responsiveClose, /@media \(max-width: 480px\)/);
  assert.match(responsiveClose, /\.bf-dialog \.bf-floating-close,\s*\.sale-dialog \.bf-floating-close\s*\{\s*top: 8px;\s*right: 8px;/);
  assert.match(responsiveClose, /\.bf-dialog-header\s*\{\s*padding-right: 68px;/);
  assert.match(sale, /width: min\(1420px, calc\(100vw - 64px\)\)/);
  assert.match(sale, /\.sale-header\s*\{\s*height: 68px;\s*padding: 0 68px 0 16px;/);
  assert.match(drive, /@media\(max-width:980px\)\{\.drive-notice\{[^}]*padding-right:58px\}\.drive-notice \.bf-floating-close\{top:6px;right:6px\}/);
  assert.match(drive, /@media\(max-width:700px\)\{\.drive-notice\{[^}]*padding:15px 54px 15px 16px\}\.drive-notice \.bf-floating-close\{top:5px;right:5px\}/);
  assert.match(confirm, /@media \(max-width: 980px\)[\s\S]*?\.confirm-content\s*\{\s*padding-right: 68px;/);
});
