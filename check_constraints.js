const { getTenantPool } = require('./src/config/db');
const pool = getTenantPool('hris_demo_corp_7');
pool.query("SELECT pg_get_constraintdef(oid) as c, conname FROM pg_constraint WHERE conrelid = 'exit_workflow_stages'::regclass")
  .then(({rows}) => console.log(rows))
  .catch(console.error)
  .then(()=>process.exit(0));
