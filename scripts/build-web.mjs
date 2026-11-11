/**
 * Stage everything the page needs into web/ so it can be served as plain
 * static files with no bundler. Two copies, both gitignored:
 *
 *   web/build/   the compiled package
 *   web/vendor/  the parser and its .wasm
 *
 * The page resolves the bare "sql-lineage" specifier through an import map
 * rather than a bundle, which keeps the whole thing readable in devtools —
 * worth more than a few saved kilobytes on a tool whose entire pitch is
 * that you can see what it does.
 */
import { cpSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const web = join(root, 'web');

rmSync(join(web, 'build'), { recursive: true, force: true });
rmSync(join(web, 'vendor'), { recursive: true, force: true });
mkdirSync(join(web, 'build'), { recursive: true });
mkdirSync(join(web, 'vendor', 'polyglot'), { recursive: true });

cpSync(join(root, 'dist'), join(web, 'build'), { recursive: true });

const sdk = join(root, 'node_modules', '@polyglot-sql', 'sdk', 'dist');
for (const f of ['index.js', 'polyglot_sql_wasm_bg.wasm']) {
  cpSync(join(sdk, f), join(web, 'vendor', 'polyglot', f));
}

const mb = (p) => (statSync(p).size / 1024 / 1024).toFixed(1) + ' MB';
console.log('staged web/build  (package)');
console.log('staged web/vendor/polyglot/index.js');
console.log('staged web/vendor/polyglot/polyglot_sql_wasm_bg.wasm  ' +
  mb(join(web, 'vendor', 'polyglot', 'polyglot_sql_wasm_bg.wasm')) + ' uncompressed');
console.log('\nNote: that .wasm is ~2.1 MB brotli-compressed, which is what the');
console.log('CDN will serve. Locally it is served raw, so first load is slower');
console.log('here than it will be in production.');
