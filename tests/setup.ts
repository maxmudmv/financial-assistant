import '@testing-library/jest-dom/vitest';

// Node 26 exposes an experimental localStorage stub without methods when --localstorage-file
// is absent; provide a spec-compliant in-memory Storage for jsdom component tests.
if (typeof window !== 'undefined' && typeof window.localStorage?.getItem !== 'function') {
  const store = new Map<string, string>();
  const memoryStorage: Storage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? (store.get(key) ?? null) : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };

  Object.defineProperty(window, 'localStorage', {
    value: memoryStorage,
    configurable: true,
    writable: true,
  });
}
