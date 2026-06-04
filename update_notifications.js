const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'modules', 'exitManagement', 'exitEvents.service.js');
let code = fs.readFileSync(file, 'utf8');

// The file has a lot of pushSafe calls. The goal is to just wrap them or add priority.
// To save time, we will replace `pushSafe(tenant, {` with `pushSafe(tenant, { priority: 'NORMAL',` where not already set.
code = code.replace(/pushSafe\(tenant,\s*\{/g, "pushSafe(tenant, { priority: 'NORMAL',");
// Fix the ones we already added priority to:
code = code.replace(/priority: 'NORMAL',\s*priority:/g, "priority:");

// Similarly, add priorities to specific titles:
code = code.replace(/priority: 'NORMAL',\s*title: 'Exit task assigned to you'/g, "priority: 'HIGH',\n        title: 'Exit task assigned to you'");
code = code.replace(/priority: 'NORMAL',\s*title: 'Exit request rejected'/g, "priority: 'CRITICAL',\n        title: 'Exit request rejected'");
code = code.replace(/priority: 'NORMAL',\s*title: 'Exit stage escalated'/g, "priority: 'CRITICAL',\n        title: 'Exit stage escalated'");

fs.writeFileSync(file, code);
console.log("Updated exitEvents.service.js priorities");
