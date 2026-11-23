const fs = require('node:fs');
const path = require('node:path');
const required = [
  'lib/estimates-api.ts',
  'lib/estimate-money.ts',
  'app/api/accounts/[accountId]/estimates/route.ts',
  'app/api/accounts/[accountId]/estimates/[estimateId]/route.ts',
  'app/api/accounts/[accountId]/estimates/[estimateId]/transition/route.ts',
  'app/accounts/[accountId]/estimates/page.tsx',
  'components/estimates/estimates-client.tsx',
  '__tests__/estimate-money.test.ts',
  'supabase/estimates.sql',
  'supabase/estimates-currency-guard.sql',
];
let missing = false;
for (const file of required) {
  const exists = fs.existsSync(path.join(process.cwd(), file));
  console.log((exists ? 'OK ' : 'MISSING ') + file);
  if (!exists) missing = true;
}
const apiPage = 'app/api/accounts/[accountId]/estimates/page.tsx';
if (fs.existsSync(apiPage)) {
  console.error('REMOVE conflicting file:', apiPage);
  missing = true;
}
process.exitCode = missing ? 1 : 0;
