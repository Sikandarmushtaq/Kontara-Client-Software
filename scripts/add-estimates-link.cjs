// Adds one navigation link to the EXISTING account overview without replacing it.
// Designed for Kontrora assignment's components/account-overview.tsx.
const fs = require('node:fs');
const path = require('node:path');
const target = path.resolve(process.cwd(), 'components/account-overview.tsx');
if (!fs.existsSync(target)) throw new Error('Run this command from the Kontrora project root.');
let source = fs.readFileSync(target, 'utf8');
const marker = '<div className="flex shrink-0 items-center gap-3">';
const snippet = `\n                <Button asChild variant="outline" size="sm">\n                  <Link href={\`/accounts/\${encodeURIComponent(String(accountId))}/estimates\`}>\n                    Estimates\n                  </Link>\n                </Button>`;
if (source.includes('href={`/accounts/${encodeURIComponent(String(accountId))}/estimates`}')) {
  console.log('Estimates link already exists. Nothing changed.');
  process.exit(0);
}
if (!source.includes("import Link from 'next/link'")) throw new Error('Could not find Link import; no changes made.');
if (!source.includes(marker)) throw new Error('Could not find account header marker; no changes made.');
fs.copyFileSync(target, target + '.before-estimates.bak');
source = source.replace(marker, marker + snippet);
fs.writeFileSync(target, source);
console.log('Added Estimates link to account overview. Backup: components/account-overview.tsx.before-estimates.bak');
