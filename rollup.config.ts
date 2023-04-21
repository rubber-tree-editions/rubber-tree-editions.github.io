import tsPlugin from '@rollup/plugin-typescript';
import nodeResolvePlugin from '@rollup/plugin-node-resolve';
import ccPlugin from '@ampproject/rollup-plugin-closure-compiler';
import commonjsPlugin from '@rollup/plugin-commonjs';
import { Plugin, RollupOptions } from 'rollup';
import { readFile } from 'node:fs/promises';
import { decode } from 'html-entities';

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
    },
  };
  return p;
}

export default config;
