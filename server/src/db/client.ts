import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { config } from "../config.js";
import * as schema from "./schema.js";

const sql = postgres(config.DATABASE_URL, { max: 5 });
export const db = drizzle(sql, { schema });
export { schema };
