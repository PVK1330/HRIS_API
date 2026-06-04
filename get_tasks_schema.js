const { getTenantPool } = require('./src/config/db');
const pool = getTenantPool('hris_demo_corp_7');
pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'tasks'")
  .then(({rows}) => console.log(rows))
  .catch(console.error)
  .then(()=>process.exit(0));
