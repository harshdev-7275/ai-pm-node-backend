import dotenv from "dotenv";

dotenv.config();


export const dotENV = {
  NODE_ENV: process.env.PORT || "development",
  PORT: process.env.PORT,
  DATABASE_URL: process.env.DATABASE_URL || "",
  DIRECT_DATABASE_URL:process.env.DIRECT_DATABASE_URL || "",
  JWT_SECRET: process.env.JWT_SECRET || "",
};