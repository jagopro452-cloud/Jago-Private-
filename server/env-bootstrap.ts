import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Must load before any module reads process.env (ESM hoists static imports).
dotenv.config({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env"),
  override: true,
});
