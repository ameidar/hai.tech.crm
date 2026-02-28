import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';

const prisma = new PrismaClient();

// WC orders loaded from cached JSON
const page1 = JSON.parse(fs.readFileSync('/tmp/woo_page1.json', 'utf8'));
const page2 = JSON.parse(fs.readFileSync('/tmp/woo_page2.json', 'utf8'));
const allOrders = [...page1, ...page2];

// Filter real orders (>₪5), unique by email (keep highest-value)
const seen: Record<string, any> = {};
for (const o of allOrders) {
  if (parseFloat(o.total || '0') <= 5) continue;
  const email = (o.billing?.email || '').toLowerCase().trim();
  if (!email) continue;
  if (!seen[email] || parseFloat(o.total) > parseFloat(seen[email].total)) {
    seen[email] = o;
  }
}

async function main() {
  console.log(`\n📦 מכין import של ${Object.keys(seen).length} לקוחות...\n`);

  // ─── 1. Virtual branch ────────────────────────────────────────────────────
  let branch = await prisma.branch.findFirst({ where: { name: 'קורסים דיגיטליים' } });
  if (!branch) {
    branch = await prisma.branch.create({
      data: { name: 'קורסים דיגיטליים', type: 'online', city: 'אונליין', isActive: true }
    });
    console.log('✅ נוצר סניף: קורסים דיגיטליים');
  } else {
    console.log('ℹ️  סניף קיים:', branch.id);
  }

  // ─── 2. Virtual instructor ────────────────────────────────────────────────
  let instructor = await prisma.instructor.findFirst({ where: { name: 'מדריך דיגיטלי' } });
  if (!instructor) {
    instructor = await prisma.instructor.create({
      data: {
        name: 'מדריך דיגיטלי',
        phone: '050-digital-0',
        rateFrontal: 0, rateOnline: 0, ratePrivate: 0,
        employmentType: 'freelancer', isActive: false,
        notes: 'מדריך וירטואלי לקורסים דיגיטליים — לא מרוויח'
      }
    });
    console.log('✅ נוצר מדריך: מדריך דיגיטלי');
  } else {
    console.log('ℹ️  מדריך קיים:', instructor.id);
  }

  // ─── 3. Courses + Cycles per product ─────────────────────────────────────
  // Group orders by product name, track earliest purchase date
  const courseMap: Record<string, { firstDate: Date; orders: any[] }> = {};
  for (const o of Object.values(seen)) {
    const products = o.line_items?.map((li: any) => li.name) || [];
    const product = products[0] || 'קורס דיגיטלי';
    const date = new Date(o.date_created || Date.now());
    if (!courseMap[product]) courseMap[product] = { firstDate: date, orders: [] };
    if (date < courseMap[product].firstDate) courseMap[product].firstDate = date;
    courseMap[product].orders.push(o);
  }

  const cycleByProduct: Record<string, string> = {}; // product → cycleId

  for (const [productName, { firstDate }] of Object.entries(courseMap)) {
    // Find or create Course
    let course = await prisma.course.findFirst({ where: { name: productName } });
    if (!course) {
      course = await prisma.course.create({
        data: { name: productName, category: 'programming', isActive: true,
          description: 'קורס דיגיטלי מהאתר' }
      });
    }

    // Find or create Cycle
    let cycle = await prisma.cycle.findFirst({
      where: { courseId: course.id, branchId: branch!.id }
    });
    if (!cycle) {
      const endDate = new Date(firstDate);
      endDate.setFullYear(endDate.getFullYear() + 1);
      const startTime = new Date('1970-01-01T00:00:00.000Z');
      const endTime = new Date('1970-01-01T01:00:00.000Z');
      cycle = await prisma.cycle.create({
        data: {
          name: productName,
          courseId: course.id,
          branchId: branch!.id,
          instructorId: instructor!.id,
          type: 'private',
          startDate: firstDate,
          endDate,
          dayOfWeek: 'sunday',
          startTime,
          endTime,
          durationMinutes: 60,
          totalMeetings: 1,
          isOnline: true,
          activityType: 'online',
          pricePerStudent: 0,
          meetingRevenue: 0,
        }
      });
      console.log(`✅ נוצר מחזור: ${productName}`);
    } else {
      console.log(`ℹ️  מחזור קיים: ${productName}`);
    }
    cycleByProduct[productName] = cycle.id;
  }

  // ─── 4. Customers + Students + Registrations ─────────────────────────────
  let created = 0, skipped = 0, errors = 0;
  const skippedList: string[] = [];

  for (const [email, order] of Object.entries(seen)) {
    const b = order.billing || {};
    const name = `${b.first_name || ''} ${b.last_name || ''}`.trim() || email;
    const phone = (b.phone || '').replace(/[\s\-]/g, '');
    const products = order.line_items?.map((li: any) => li.name) || [];
    const productName = products[0] || 'קורס דיגיטלי';
    const amount = parseFloat(order.total || '0');
    const cycleId = cycleByProduct[productName];

    try {
      // Check if customer exists by email or phone
      let customer = await prisma.customer.findFirst({ where: { email } });
      if (!customer && phone) {
        customer = await prisma.customer.findFirst({ where: { phone } });
      }
      if (customer) {
        skipped++;
        skippedList.push(`${name} (${email})`);
        continue;
      }

      // Skip internal accounts
      if (['ami@hai.tech', 'inna@hai.tech', 'info@hai.tech', 'ami.meidar@gmail.com'].includes(email)) {
        skipped++;
        skippedList.push(`${name} (${email}) — חשבון פנימי`);
        continue;
      }

      // If no phone, generate unique placeholder
      const finalPhone = phone || `DIG-${order.id}`;

      // Check if phone already in use by another customer
      const phoneConflict = await prisma.customer.findFirst({ where: { phone: finalPhone } });
      const safePhone = phoneConflict ? `DIG-${order.id}-${Date.now()}` : finalPhone;

      // Create customer
      customer = await prisma.customer.create({
        data: { name, email, phone: safePhone }
      });

      // Create student (child name = buyer name)
      const student = await prisma.student.create({
        data: { customerId: customer.id, name }
      });

      // Create registration
      await prisma.registration.create({
        data: {
          studentId: student.id,
          cycleId,
          status: 'completed',
          amount,
          paymentStatus: 'paid',
          paymentMethod: 'credit',
          registrationDate: new Date(order.date_created || Date.now()),
          notes: `יובא אוטומטית מ-WooCommerce הזמנה #${order.id}`
        }
      });

      // Link payment record if exists
      const payment = await prisma.payment.findFirst({ where: { wooOrderId: Number(order.id) } });
      if (payment && !payment.customerId) {
        await prisma.payment.update({
          where: { id: payment.id },
          data: { customerId: customer.id }
        });
      }

      created++;
      console.log(`  ✅ ${name} | ${email} | ${productName}`);
    } catch (e: any) {
      errors++;
      console.error(`  ❌ שגיאה: ${name} | ${email} — ${e.message}`);
    }
  }

  console.log(`\n📊 סיכום:`);
  console.log(`  נוצרו: ${created} לקוחות חדשים`);
  console.log(`  דולגו (כבר קיימים): ${skipped}`);
  console.log(`  שגיאות: ${errors}`);
  if (skippedList.length > 0) {
    console.log(`\n⚠️  קיימים (לבדיקה):`);
    skippedList.forEach(s => console.log(`  - ${s}`));
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
