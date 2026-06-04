const db = require('./src/config/db');
async function run() {
  try {
    const pool = await db.getTenantPool('microlan-it-services-pvt-ltd');
    const res = await pool.query(`
      SELECT table_name, column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name IN ('exit_tasks', 'exit_request_checklist_items', 'exit_request_attachments', 'workflow_audit_logs', 'exit_approvals')
    `);
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}
run();
