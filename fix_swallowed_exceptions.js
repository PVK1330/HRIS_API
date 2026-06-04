const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'src', 'modules', 'exitManagement');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));

for (const file of files) {
  const filePath = path.join(dir, file);
  let content = fs.readFileSync(filePath, 'utf8');
  const initialContent = content;
  
  content = content.replace(/\.catch\(\(\)\s*=>\s*\{\s*\}\)/g, ".catch((e) => console.error('Exit workflow event error:', e))");
  content = content.replace(/\.catch\(\(\)\s*=>\s*null\)/g, ".catch((e) => { console.error('Exit workflow event error:', e); return null; })");
  
  if (content !== initialContent) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('Fixed swallowed exceptions in', file);
  }
}
