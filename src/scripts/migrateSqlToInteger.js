const fs = require('fs');
const path = require('path');

const dir = 'c:\\Users\\pkk22\\OneDrive\\Desktop\\TECHNOWEB\\HRIS PROJECT\\HRIS_PROJECT\\HRIS_API\\src\\migrations\\tenants';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql'));

files.forEach(file => {
  const filePath = path.join(dir, file);
  let content = fs.readFileSync(filePath, 'utf8');

  // Replace UUID PK
  content = content.replace(/UUID PRIMARY KEY DEFAULT gen_random_uuid\(\)/gi, 'SERIAL PRIMARY KEY');
  
  // Replace remaining UUIDs (mostly FKs) with INTEGER
  // We avoid replacing it if it's already SERIAL PRIMARY KEY
  content = content.replace(/UUID/gi, 'INTEGER');

  fs.writeFileSync(filePath, content);
  console.log(`Updated ${file}`);
});
