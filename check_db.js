const db = require('./src/config/db');

async function check() {
    try {
        const res = await db.query("SELECT to_regclass('public.employee_salaries')");
        console.log("Table check result:", res.rows[0]);
        
        const tables = await db.query("SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public'");
        console.log("All tables in public schema:", tables.rows.map(r => r.tablename));
    } catch (e) {
        console.error("Error checking database:", e);
    } finally {
        process.exit();
    }
}

check();
