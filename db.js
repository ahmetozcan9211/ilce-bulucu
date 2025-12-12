import "dotenv/config";
import pg from "pg";
const { Pool } = pg;

export const pool = new Pool({
    host: process.env.PG_HOST,
    port: Number(process.env.PG_PORT || 5432),
    user: process.env.PG_USER,
    password: process.env.PG_PASS,
    database: process.env.PG_DB,
});