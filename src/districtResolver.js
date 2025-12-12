import fs from "fs";
import path from "path";
import Fuse from "fuse.js";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const districtsByCity = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../districts.json"), "utf8")
);

function normalizeTR(s) {
    return (s || "")
        .toString()
        // ✅ i̇stanbul gibi combining karakterleri düzelt
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLowerCase()
        .replaceAll("ı", "i")
        .replaceAll("ğ", "g")
        .replaceAll("ü", "u")
        .replaceAll("ş", "s")
        .replaceAll("ö", "o")
        .replaceAll("ç", "c")
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function getCityDistricts(cityKey) {
    // 1) Direkt key
    if (districtsByCity[cityKey]) return districtsByCity[cityKey];

    // 2) Key normalizasyon eşleşmesi (i̇stanbul vs istanbul)
    const k = Object.keys(districtsByCity).find((x) => normalizeTR(x) === cityKey);
    return k ? districtsByCity[k] : null;
}

function containsWord(haystack, needle) {
    const h = ` ${haystack} `;
    const n = ` ${needle} `;
    return h.includes(n);
}

export function resolveDistrictLocal({ address, city }) {
    const cityKey = normalizeTR(city);
    const addressNorm = normalizeTR(address);

    const districts = getCityDistricts(cityKey);
    if (!districts?.length) {
        return {
            district: null,
            confidence: 0,
            method: "no-city-data",
            candidates: [],
        };
    }

    // 1) Kelime olarak direkt geçiyor mu?
    const exactHits = [];
    for (const d of districts) {
        const dn = normalizeTR(d);
        if (dn.length >= 3 && containsWord(addressNorm, dn)) exactHits.push(d);
    }

    if (exactHits.length === 1) {
        return {
            district: exactHits[0],
            confidence: 0.98,
            method: "exact-word",
            candidates: [{ district: exactHits[0], confidence: 0.98 }],
        };
    }

    // 2) Fuzzy (Fuse.js)
    const items = districts.map((d) => ({ name: d, norm: normalizeTR(d) }));

    const fuse = new Fuse(items, {
        keys: ["norm"],
        includeScore: true,
        threshold: 0.35,
        ignoreLocation: true,
        minMatchCharLength: 3,
    });

    const results = fuse.search(addressNorm).slice(0, 5);
    if (!results.length) {
        return { district: null, confidence: 0, method: "fuse-none", candidates: [] };
    }

    const best = results[0];
    const conf = Math.max(0, Math.min(1, 1 - (best.score ?? 1)));

    return {
        district: best.item.name,
        confidence: Number(conf.toFixed(2)),
        method: exactHits.length > 1 ? "exact-multi+fuzzy" : "fuzzy",
        candidates: results.map((r) => ({
            district: r.item.name,
            confidence: Number(Math.max(0, Math.min(1, 1 - (r.score ?? 1))).toFixed(2)),
        })),
    };
}