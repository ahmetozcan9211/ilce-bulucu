import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { cacheGet, cacheSet } from "./cache.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const districtsByCity = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../districts.json"), "utf8")
);

function normalizeTR(s) {
    return (s || "")
        .toString()
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
        .replace(/\s+/g, " ");
}

function getCityDistricts(city) {
    const key = normalizeTR(city);
    if (districtsByCity[key]) return districtsByCity[key];
    const k = Object.keys(districtsByCity).find((x) => normalizeTR(x) === key);
    return k ? districtsByCity[k] : null;
}

function pickDistrictFromAddress(a) {
    return (
        a.city_district ||
        a.county ||
        a.district ||
        a.borough ||
        a.municipality ||
        a.town ||
        null
    );
}

function extractNeighborhood(addressText) {
    const t = addressText || "";
    const m = t.match(/([^\d,]+?)\s+(mahallesi|mah\.|mh\.)/i);
    return m ? m[1].trim() : null;
}

function extractStreet(addressText) {
    const t = addressText || "";
    const m = t.match(
        /([^\d,]+?)\s+(caddesi|cad\.|cd\.|sokak|sk\.|bulvarı|blv\.)/i
    );
    return m ? m[1].trim() : null;
}

function stripNo(addressText) {
    return (addressText || "")
        .replace(/\bno\s*:\s*\d+\b/gi, "")
        .replace(/\bno\s*\d+\b/gi, "")
        .replace(/\b\d{1,5}\b/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

async function nominatimSearch(q) {
    const url =
        "https://nominatim.openstreetmap.org/search?" +
        new URLSearchParams({
            q,
            format: "jsonv2",
            addressdetails: "1",
            limit: "3",
            countrycodes: "tr",
            dedupe: "1",
        });

    const r = await fetch(url, {
        headers: {
            "User-Agent": "ilce-bulucu/1.0 (contact: admin@yourdomain.com)",
            "Accept-Language": "tr",
        },
    });

    const text = await r.text();
    if (!r.ok)
        return { ok: false, status: r.status, data: [], detail: text.slice(0, 300) };

    try {
        const data = JSON.parse(text);
        return { ok: true, status: r.status, data: Array.isArray(data) ? data : [] };
    } catch {
        return { ok: false, status: r.status, data: [], detail: text.slice(0, 300) };
    }
}

async function nominatimReverse(lat, lon) {
    const url =
        "https://nominatim.openstreetmap.org/reverse?" +
        new URLSearchParams({
            lat: String(lat),
            lon: String(lon),
            format: "jsonv2",
            addressdetails: "1",
            zoom: "18",
        });

    const r = await fetch(url, {
        headers: {
            "User-Agent": "ilce-bulucu/1.0 (contact: admin@yourdomain.com)",
            "Accept-Language": "tr",
        },
    });

    const text = await r.text();
    if (!r.ok)
        return { ok: false, status: r.status, data: null, detail: text.slice(0, 300) };

    try {
        return { ok: true, status: r.status, data: JSON.parse(text) };
    } catch {
        return { ok: false, status: r.status, data: null, detail: text.slice(0, 300) };
    }
}

function standardizeDistrictName(city, districtGuess) {
    const districts = getCityDistricts(city) || [];
    if (!districtGuess) return null;

    const g = normalizeTR(districtGuess);
    const exact = districts.find((d) => normalizeTR(d) === g);
    if (exact) return exact;

    const near = districts.find(
        (d) => normalizeTR(d).includes(g) || g.includes(normalizeTR(d))
    );
    return near || districtGuess;
}

export async function resolveDistrictByGeocoding({ address, city }) {
    // ✅ CACHE KEY
    const cacheKey = normalizeTR(`${city}||${address}`);
    const cached = cacheGet(cacheKey);
    if (cached) {
        return { ...cached, method: `${cached.method}+cache` };
    }

    const districts = getCityDistricts(city);
    if (!districts?.length) {
        const result = { district: null, confidence: 0, method: "no-city-data", candidates: [] };
        cacheSet(cacheKey, result, 10 * 60 * 1000); // 10 dk cache (negatif sonuç)
        return result;
    }

    const nb = extractNeighborhood(address);
    const st = extractStreet(address);
    const addrNoStripped = stripNo(address);

    const queries = [];
    queries.push(`${addrNoStripped}, ${city}, Türkiye`);
    if (nb) queries.push(`${nb}, ${city}, Türkiye`);
    if (nb) queries.push(`${nb} Mahallesi, ${city}, Türkiye`);
    if (st) queries.push(`${st} Caddesi, ${city}, Türkiye`);
    queries.push(`${addrNoStripped}, Türkiye`);

    let usedQuery = null;
    let hit = null;
    let lastStatus = 0;

    for (const q of queries) {
        const s = await nominatimSearch(q);
        lastStatus = s.status || 0;
        if (s.ok && s.data.length) {
            hit = s.data[0];
            usedQuery = q;
            break;
        }
    }

    if (!hit) {
        const result = {
            district: null,
            confidence: 0,
            method: "geocode-none",
            debug: { status: lastStatus, triedQueries: queries },
        };
        cacheSet(cacheKey, result, 10 * 60 * 1000); // 10 dk cache (negatif sonuç)
        return result;
    }

    const rev = await nominatimReverse(hit.lat, hit.lon);
    if (!rev.ok || !rev.data?.address) {
        const result = {
            district: null,
            confidence: 0,
            method: "reverse-failed",
            debug: { status: rev.status, detail: rev.detail, usedQuery },
            meta: { lat: hit.lat, lon: hit.lon, display_name: hit.display_name },
        };
        cacheSet(cacheKey, result, 10 * 60 * 1000); // 10 dk cache (negatif sonuç)
        return result;
    }

    const rawDistrict = pickDistrictFromAddress(rev.data.address);
    const district = standardizeDistrictName(city, rawDistrict);

    const result = {
        district: district || null,
        confidence: district ? 0.95 : 0,
        method: "neighborhood-first-search+reverse-nominatim",
        meta: {
            usedQuery,
            lat: hit.lat,
            lon: hit.lon,
            display_name: hit.display_name,
            reverse_fields: {
                city_district: rev.data.address.city_district,
                county: rev.data.address.county,
                borough: rev.data.address.borough,
                district: rev.data.address.district,
                suburb: rev.data.address.suburb,
                neighbourhood: rev.data.address.neighbourhood,
                quarter: rev.data.address.quarter,
                city: rev.data.address.city,
                state: rev.data.address.state,
            },
        },
    };

    cacheSet(cacheKey, result, 7 * 24 * 60 * 60 * 1000); // ✅ 7 gün cache (başarılı)
    return result;
}