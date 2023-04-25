import tsPlugin from '@rollup/plugin-typescript';
import nodeResolvePlugin from '@rollup/plugin-node-resolve';
import ccPlugin from '@ampproject/rollup-plugin-closure-compiler';
import commonjsPlugin from '@rollup/plugin-commonjs';
import { Plugin, RollupOptions } from 'rollup';
import { mkdtemp, readFile } from 'node:fs/promises';
import { decode } from 'html-entities';
import fspath from 'node:path';
import asc from 'assemblyscript/asc';
import { tmpdir } from 'node:os';

const config: RollupOptions[] = [];

config.push({
  input: ['./src/main.ts'],
  output: {
    format: 'iife',
    file: './build/main.js',
    name: 'main',
  },
  plugins: [
    tsPlugin(),
    nodeResolvePlugin(),
    ccPlugin(),
    commonjsPlugin(),
    customPlugin(),
  ],
});

const REF_RX = /<(?:script|link)(?:[^>"']+|"[^"]*"|'[^']*')*>/ig;

function customPlugin(): Plugin {
  const p: Plugin = {
    name: 'customPlugin',
    async resolveId(source, importer, options) {
      if (source.startsWith('asc:')) {
				const resolution = await this.resolve(source.slice(4) + '.ts', importer, {
					skipSelf: true,
					...options
				});
        if (!resolution || resolution.external) return resolution;
        return `asc:${resolution.id.slice(0, -3)}`;
      }
    },
    async load(id) {
      if (/\.html$/i.test(id)) {
        const html = await readFile(id, {encoding:'utf-8'});
        this.emitFile({
          type: 'asset',
          fileName: id.match(/[^\\/]+$/)![0],
          source: html,
        });
        const refs: string[] = [];
        for (const match of (html.match(REF_RX) || [])) {
          const src = match.match(/\b(?:src|href)\s*=\s*("[^"]+"|'[^']+'|[^"'>\s]+)/i);
          let url = src ? src[1] : '';
          if (/^["']/.test(url)) url = url.slice(1, -1);
          url = decode(url);
          if (/\.js$/i.test(url)) {
            refs.push('./' + url.slice(0, -3));
          }
          else if (/\.css$/i.test(url)) {
            refs.push('./' + url);
          }
        }
        return `
          ${refs.map(v => `import ${JSON.stringify(v)};`).join('\n')}
          export const url = ${JSON.stringify(id)};
        `;
      }
      else if (/\.css$/i.test(id)) {
        const css = await readFile(id, {encoding:'utf-8'});
        this.emitFile({
          type: 'asset',
          fileName: id.match(/[^\\/]+$/)![0],
          source: css,
        });
        return `
          export const url = ${JSON.stringify(id)};
        `;
      }
      else if (/^asc:/i.test(id)) {
        id = id.slice(4);
        const baseName = id.replace(/^.*[\\\/]/i, '').replace(/\.ts$/i, '');
        const wasmPath = fspath.join(await mkdtemp(fspath.join(tmpdir(), 'wasm-')), baseName + '.wasm');
        const { error, stdout, stderr, stats } = await asc.main([
          id,
          "--outFile", wasmPath,
          "--optimize",
          "--stats"
        ]);
        if (error) {
          console.log("Compilation failed: " + error.message);
          console.log(stderr.toString());
          return `throw new Error(${JSON.stringify('Compilation failed: ' + error.message)}); const url = 'data:application/octet-stream;utf8,'; export default url;`;
        }
        else {
          console.log(stdout.toString());
          const wasmBinary = await readFile(wasmPath);
          const key = this.emitFile({
            type: 'asset',
            fileName: baseName + '.wasm',
            source: wasmBinary,
          });
          return `
            const url = import.meta.ROLLUP_FILE_URL_${key};
            export default url;
          `;
        }
      }
    },
  };
  return p;
}

export default config;
