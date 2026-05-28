const fs = require('fs');
const path = require('path');
const p = path.resolve('c:/Users/pkk22/OneDrive/Desktop/TECHNOWEB/HRIS PROJECT/HRIS_PROJECT/HRIS_API/src/modules/employees/onboarding/onboarding.service.js');
let code = fs.readFileSync(p, 'utf8');

code = code.replace(
  /const pdf = await generateOfferLetterPdf\(\{([\s\S]*?)managerName: emp\.manager_name,?\s*\}\);/,
  `const pdf = await generateOfferLetterPdf({$1managerName: emp.manager_name,\n      pool,\n      tenant: { company_name: companyName, dbName: user.db_name }\n    });`
);

fs.writeFileSync(p, code, 'utf8');
console.log('Patched onboarding.service.js');
