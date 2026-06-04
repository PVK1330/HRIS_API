const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'modules', 'exitManagement', 'exitManagement.controller.js');
const lines = fs.readFileSync(file, 'utf8').split('\n');

const fixedLines = lines.slice(173); // Keep lines 174 (index 173) onwards
fs.writeFileSync(file, fixedLines.join('\n'), 'utf8');
console.log('Fixed exitManagement.controller.js');
