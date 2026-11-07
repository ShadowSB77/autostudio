// Copies the shared engine into the edge-functions folder (Deno needs it next to the functions).
import fs from 'node:fs';
for (const f of ['schedule.ts', 'tenantConfig.ts']) {
  fs.copyFileSync(`src/shared/${f}`, `supabase/functions/_shared/${f}`);
}
for (const fn of ['booking', 'assistant', 'ops', 'reminders']) {
  fs.writeFileSync(`supabase/functions/${fn}/deno.json`, JSON.stringify({ imports: {
    'date-fns-tz': 'npm:date-fns-tz@3.2.0', 'zod': 'npm:zod@4.6.7',
  } }, null, 2) + '\n');
}
console.log('shared files synced');
