/**
 * Digital Course Customers Import
 * Imports WooCommerce buyers as CRM Customers only (no students/cycles/registrations).
 * Run: node --require tsx/cjs --require dotenv/config src/scripts/digital-import.ts
 */
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

// WC order files — expect these in /tmp/ (copy there before running)
const WOO_FILES = ['/tmp/woo_page1.json', '/tmp/woo_page2.json'];

interface WooOrder {
  id: number;
  status: string;
  total: string;
  billing: {
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
  };
  line_items: Array<{ name: string; total: string }>;
}

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  // Convert 972XXXXXXXXX → 0XXXXXXXXX
  if (digits.startsWith('972') && digits.length >= 12) return '0' + digits.slice(3);
  return digits;
}

async function main() {
  console.log('=== Digital Course Customer Import ===\n');

  // Load all orders
  const allOrders: WooOrder[] = [];
  for (const file of WOO_FILES) {
    if (!fs.existsSync(file)) { console.warn(`⚠️  File not found: ${file}`); continue; }
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    allOrders.push(...data);
  }
  console.log(`Loaded ${allOrders.length} orders from WooCommerce files`);

  // Filter: paid orders with amount > 5
  const paidOrders = allOrders.filter(o =>
    ['completed', 'processing', 'on-hold'].includes(o.status) &&
    parseFloat(o.total) > 5 &&
    o.billing.email &&
    !['info@hai.tech', 'ami@hai.tech', 'inna@hai.tech'].includes(o.billing.email.toLowerCase())
  );
  console.log(`After filtering: ${paidOrders.length} valid orders`);

  // Deduplicate by email — keep highest total
  const byEmail = new Map<string, WooOrder>();
  for (const order of paidOrders) {
    const email = order.billing.email.toLowerCase();
    const existing = byEmail.get(email);
    if (!existing || parseFloat(order.total) > parseFloat(existing.total)) {
      byEmail.set(email, order);
    }
  }
  console.log(`After dedup by email: ${byEmail.size} unique customers\n`);

  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (const [email, order] of byEmail) {
    const firstName = order.billing.first_name || '';
    const lastName = order.billing.last_name || '';
    const fullName = `${firstName} ${lastName}`.trim() || email;
    const rawPhone = order.billing.phone || '';
    const phone = normalizePhone(rawPhone) || `DIG-${order.id}`;

    // Skip if already in CRM
    const existingByEmail = await prisma.customer.findFirst({ where: { email } });
    if (existingByEmail) {
      console.log(`  ⏭️  Already exists (email): ${email}`);
      skipped++;
      continue;
    }

    // Check phone too
    const existingByPhone = phone.startsWith('DIG-') ? null :
      await prisma.customer.findFirst({ where: { phone } });
    if (existingByPhone) {
      console.log(`  ⏭️  Already exists (phone ${phone}): ${email}`);
      skipped++;
      continue;
    }

    // Handle phone uniqueness for placeholder phones
    let finalPhone = phone;
    if (phone.startsWith('DIG-')) {
      // Already unique by order ID
    } else {
      // Check for duplicate phone (different emails, same phone)
      const dupPhone = await prisma.customer.findFirst({ where: { phone } });
      if (dupPhone) finalPhone = `DIG-${order.id}`;
    }

    try {
      const customer = await prisma.customer.create({
        data: {
          name: fullName,
          email,
          phone: finalPhone,
          notes: `ייבוא אוטומטי מ-WooCommerce (הזמנה #${order.id})`,
        },
      });
      console.log(`  ✅ Created: ${fullName} <${email}> | ${finalPhone}`);
      created++;
    } catch (e: any) {
      console.error(`  ❌ Error creating ${email}: ${e.message}`);
      errors++;
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`  Created:  ${created}`);
  console.log(`  Skipped:  ${skipped}`);
  console.log(`  Errors:   ${errors}`);
  console.log(`\nDone! Payments will auto-link to customers by email/phone via sync-woo.`);

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
