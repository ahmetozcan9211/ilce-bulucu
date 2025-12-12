import fs from "fs";
import path from "path";

function normalizeKeyTR(s) {
    return (s || "")
        .toString()
        .trim()
        .toLowerCase()
        .replaceAll("ı", "i")
        .replaceAll("ğ", "g")
        .replaceAll("ü", "u")
        .replaceAll("ş", "s")
        .replaceAll("ö", "o")
        .replaceAll("ç", "c");
}

const inPath = path.resolve("data/turkey-geo.json");
const outPath = path.resolve("districts.json");

// BOM varsa temizle (bazı raw json’larda olabiliyor)
let txt = fs.readFileSync(inPath, "utf8");
txt = txt.replace(/^\uFEFF/, "");

const geo = JSON.parse(txt); // Array

const districtsByCity = {};

for (const prov of geo) {
    const cityName = prov?.Province;
    const cityKey = normalizeKeyTR(cityName);

    const districts = (prov?.Districts || [])
        .map((d) => d?.District)
        .filter(Boolean);

    // tekil + alfabetik
    districtsByCity[cityKey] = [...new Set(districts)].sort((a, b) =>
        a.localeCompare(b, "tr")
    );
}

fs.writeFileSync(outPath, JSON.stringify(districtsByCity, null, 2), "utf8");
console.log("✅ districts.json oluşturuldu:", outPath);