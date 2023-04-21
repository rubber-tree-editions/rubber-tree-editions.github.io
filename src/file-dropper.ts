
export type FileOrDir = (File & {isDir?: false}) | {name: string; isDir: true; entries: FileOrDir[]};

function fromEntry(entry: FileSystemEntry | null): Promise<FileOrDir | null> {
  if (entry === null) return Promise.resolve(null);
  if (entry.isDirectory) {
    const dir = entry as FileSystemDirectoryEntry;
    return new Promise<FileOrDir>((resolve, reject) => {
      const reader = dir.createReader();
      reader.readEntries(
        entries => {
          Promise.all(entries.map(fromEntry))
          .then(entries => {
            resolve({
              name: entry.name,
              isDir: true,
              entries: entries as FileOrDir[],
            });
          });
        },
        reject,
      );   
    });
  }
  else if (entry.isFile) {
    return new Promise((resolve, reject) => {
      (entry as FileSystemFileEntry).file(
        resolve,
        reject,
      );
    });
  }
  else {
    return Promise.resolve(null);
  }
}

function fromItem(item: DataTransferItem): Promise<FileOrDir | null> {
  if (item.kind !== 'file') return Promise.resolve(null);
  if (typeof (item as any).getAsEntry === 'function') {
    return fromEntry((item as any).getAsEntry());
  }
  if (typeof item.webkitGetAsEntry === 'function') {
    return fromEntry(item.webkitGetAsEntry());
  }
  return Promise.resolve(item.getAsFile());
}

export function makeFileDropper(el: HTMLElement, callback: (received: FileOrDir[]) => void) {
  let dragCount = 0;
  el.addEventListener('dragenter', e => {
    e.preventDefault();
    e.stopPropagation();
    if (++dragCount === 1) {
      el.classList.add('dropping');
    }
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  });
  el.addEventListener('dragleave', e => {
    e.preventDefault();
    e.stopPropagation();
    if (--dragCount === 0) {
      el.classList.remove('dropping');
    }
  });
  el.addEventListener('dragover', e => {
    e.preventDefault();
    e.stopPropagation();
  });
  el.addEventListener('drop', e => {
    e.preventDefault();
    e.stopPropagation();
    if (--dragCount === 0) {
      el.classList.remove('dropping');
    }
    const entries: Promise<FileOrDir | null>[] = [];
    const items: ArrayLike<DataTransferItem> = e.dataTransfer?.items || [];
    for (let i = 0; i < items.length; i++) {
      entries.push(fromItem(items[i]));
    }
    Promise.all(entries).then(entries => {
      const filtered = entries.filter((v): v is FileOrDir => v !== null);
      if (filtered.length !== 0) {
        callback(filtered);
      }
    });
  });
  el.classList.add('file-dropper');
}
