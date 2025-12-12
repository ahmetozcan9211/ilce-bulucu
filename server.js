import express from "express";
import { resolveDistrictByGeocoding } from "./src/geocodeResolver.js";
import { pool } from "./db.js";
import "dotenv/config";

const app = express();
app.use(express.json({ limit: "1mb" }));

app.post("/api/resolve-district", async (req, res) => {
    const { customer, address, city } = req.body || {};
    if (!customer || !address || !city) {
        return res.status(400).json({ ok: false, error: "customer, address, city zorunlu" });
    }

    // 1) İlçe bul
    const result = await resolveDistrictByGeocoding({ address, city });

    if (!result?.district) {
        return res.json({
            ok: true,
            updated: false,
            ...result,
            message: "İlçe bulunamadı, DB güncellenmedi.",
        });
    }

    // 2) DB güncelle (SQL injection-safe)
    // UPDATE IASCUSTOMER SET ILCE=$1 WHERE COMPANY='02' AND CUSTOMER=$2
    const ilce = result.district;

    try {
        const sql = `
      UPDATE IASCUSTOMER
      SET ILCE = $1
      WHERE COMPANY = '02'
        AND CUSTOMER = $2
    `;
        const params = [ilce, String(customer)];

        const dbRes = await pool.query(sql, params);

        return res.json({
            ok: true,
            updated: dbRes.rowCount > 0,
            rowCount: dbRes.rowCount,
            customer: String(customer),
            district: ilce,
            confidence: result.confidence,
            method: result.method,
            meta: result.meta,
        });
    } catch (e) {
        return res.status(500).json({
            ok: false,
            error: "DB update failed",
            detail: e?.message,
        });
    }
});

app.listen(3000, () => console.log("✅ http://localhost:3000"));