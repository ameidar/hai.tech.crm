/**
 * Link active cycles to institutional orders based on Fireberry CSV export
 * Usage: node dist/scripts/link-cycles-to-orders.js <path-to-csv>
 */

import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current); current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

function parseCSV(content: string): Record<string, string>[] {
  const lines = content.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]);
  return lines.slice(1).map(line => {
    const values = parseCSVLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = values[i] ?? ''; });
    return row;
  });
}

async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) { console.error('Usage: node dist/scripts/link-cycles-to-orders.js <csv>'); process.exit(1); }
  const content = fs.readFileSync(path.resolve(csvPath), 'utf-8');
  const rows = parseCSV(content);
  console.log(`📄 Parsed ${rows.length} rows`);

  // Load all institutional orders (map orderName → id)
  const allOrders = await prisma.institutionalOrder.findMany({ select: { id: true, orderName: true } });
  const orderByName = new Map<string, string>();
  for (const o of allOrders) {
    if (o.orderName) orderByName.set(o.orderName.trim(), o.id);
  }
  console.log(`📋 Loaded ${allOrders.length} institutional orders`);

  // Load all active cycles (map name → id)
  const allCycles = await prisma.cycle.findMany({
    where: { status: 'active' },
    select: { id: true, name: true, institutionalOrderId: true },
  });
  const cycleByName = new Map<string, string>();
  for (const c of allCycles) cycleByName.set(c.name.trim(), c.id);
  console.log(`🔄 Loaded ${allCycles.length} active cycles`);

  let linked = 0;
  let noOrder = 0;
  let noCycle = 0;
  let skipped = 0;

  for (const row of rows) {
    const cycleName = row['שם המחזור']?.trim();
    const orderName = row['שייך להזמנה מוסדית']?.trim();

    if (!cycleName || !orderName || orderName === '-') { skipped++; continue; }

    const cycleId = cycleByName.get(cycleName);
    if (!cycleId) { console.warn(`⚠️  Cycle not found: "${cycleName}"`); noCycle++; continue; }

    // Find order by exact name, then partial match
    let orderId = orderByName.get(orderName);
    if (!orderId) {
      const entry = [...orderByName.entries()].find(([k]) =>
        k.includes(orderName) || orderName.includes(k)
      );
      orderId = entry?.[1];
    }
    if (!orderId) { console.warn(`⚠️  Order not found: "${orderName}"`); noOrder++; continue; }

    await prisma.cycle.update({
      where: { id: cycleId },
      data: { institutionalOrderId: orderId },
    });
    console.log(`✅ "${cycleName}" → "${orderName}"`);
    linked++;
  }

  console.log(`\n📊 Summary:`);
  console.log(`   Linked:          ${linked}`);
  console.log(`   Skipped (no order name): ${skipped}`);
  console.log(`   Cycle not found: ${noCycle}`);
  console.log(`   Order not found: ${noOrder}`);
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
