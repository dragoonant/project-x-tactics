// Lists campaign seeds whose week 1 has a raid (for e2e and screenshots). Usage: npx tsx tools/campaign-seeds.ts [count]
import { createCampaign } from '../src/campaign'

const want = Number(process.argv[2] ?? 5)
const found: string[] = []
for (let seed = 1; seed < 500 && found.length < want; seed++) {
  const s = createCampaign({ seed })
  const raid = s.incidents.find((i) => i.kind === 'raid')
  if (raid) found.push(`seed ${seed}: ${s.incidents.map((i) => `${i.id} ${i.kind} ${i.district} d${i.difficulty}`).join(', ')}`)
}
console.log(found.join('\n'))
