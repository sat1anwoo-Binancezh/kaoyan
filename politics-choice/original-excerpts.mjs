const backupBook = 'politics-original-2027';
let opening;

function database() {
  opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('politics-original-pdf-v2', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('clips', {keyPath: 'id'});
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch(error => {
    opening = undefined;
    throw error;
  });
  return opening;
}

async function clips(mode, action) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('clips', mode);
    const result = action(tx.objectStore('clips'));
    tx.oncomplete = () => resolve(result?.result);
    tx.onabort = () => reject(tx.error);
    tx.onerror = () => reject(tx.error);
  });
}

export const loadImages = () => clips('readonly', store => store.getAll());
export const removeImage = id => clips('readwrite', store => store.delete(id));

export function updateImageNote(id, note) {
  return clips('readwrite', store => {
    const request = store.get(id);
    request.onsuccess = () => {
      if (request.result) store.put({...request.result, note});
    };
  });
}

export function mergeImages(records) {
  return clips('readwrite', store => {
    for (const record of records) {
      const request = store.get(record.id);
      request.onsuccess = () => {
        const existing = request.result;
        if (!existing) store.put(record);
        else if (record.note && !existing.note) store.put({...existing, note: record.note});
      };
    }
  });
}

export function isImageBackup(data) {
  return data?.version === 2 && data.book === backupBook && Array.isArray(data.entries);
}

export async function readImageBackup(data) {
  if (!isImageBackup(data)) throw new Error('Invalid image backup');
  const records = [];
  for (const {page, first, last, created, note, image} of data.entries) {
    if (!Number.isInteger(page) || page < 1 || page > 72 ||
        !Number.isInteger(first) || !Number.isInteger(last) || first < 0 || last < first ||
        typeof image !== 'string' || !image.startsWith('data:image/png;base64,iVBORw0KGgo')) {
      throw new Error('Invalid image excerpt');
    }
    const blob = await (await fetch(image)).blob();
    records.push({
      id: `original-${page}-${first}-${last}`, page, first, last, blob,
      created: Number.isFinite(created) ? created : Date.now(),
      note: typeof note === 'string' ? note : ''
    });
  }
  return records;
}

function asDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function exportImageBackup() {
  const entries = [];
  for (const {blob, ...record} of await loadImages()) {
    entries.push({...record, image: await asDataURL(blob)});
  }
  return {version: 2, book: backupBook, entries};
}
