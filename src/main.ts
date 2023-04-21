
import { FileOrDir, makeFileDropper } from './file-dropper';
import './index.html';

async function main() {
  makeFileDropper(document.body, (received) => {
    function handleFile(folders: string[], file: File) {
    }
    function handleEntries(folders: string[], entries: FileOrDir[]) {
      for (const entry of entries) {
        if (entry.isDir) {
          handleEntries([...folders, entry.name], entry.entries);
        }
        else {
          handleFile(folders, entry);
        }
      }
    }
    handleEntries([], received);
  });
}

window.addEventListener('DOMContentLoaded', main, { once: true });

export default main;
