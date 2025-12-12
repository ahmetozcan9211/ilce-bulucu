// src/cache.js
const store = new Map();

/**
 * @param {string} key
 * @returns {any|null}
 */
export function cacheGet(key) {
    const v = store.get(key);
    if (!v) return null;

    if (v.expiresAt && Date.now() > v.expiresAt) {
        store.delete(key);
        return null;
    }
    return v.value;
}

/**
 * @param {string} key
 * @param {any} value
 * @param {number} ttlMs
 */
export function cacheSet(key, value, ttlMs) {
    store.set(key, {
        value,
        expiresAt: ttlMs ? Date.now() + ttlMs : null,
    });
}

export function cacheStats() {
    return { size: store.size };
}