// @/db builds its pool from DATABASE_URL when first imported, so the database
// tests must point it at the test database before any test file loads it.
// Without TEST_DATABASE_URL those tests skip and the pool never connects.
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
