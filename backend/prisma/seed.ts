import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Create admin user
  const adminPassword = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'admin123', 10);
  
  const admin = await prisma.user.upsert({
    where: { email: process.env.ADMIN_EMAIL || 'admin@haitech.co.il' },
    update: {},
    create: {
      email: process.env.ADMIN_EMAIL || 'admin@haitech.co.il',
      passwordHash: adminPassword,
      name: process.env.ADMIN_NAME || 'מנהל מערכת',
      role: 'admin',
    },
  });

  console.log(`✅ Admin user created: ${admin.email}`);

  // Create sample courses
  const courses = await Promise.all([
    prisma.course.upsert({
      where: { id: 'c1' },
      update: {},
      create: {
        id: 'c1',
        name: 'מיינקראפט JavaScript',
        description: 'לימוד תכנות JavaScript דרך עולם המיינקראפט',
        targetAudience: 'כיתות ג-ד',
        category: 'programming',
        isActive: true,
      },
    }),
    prisma.course.upsert({
      where: { id: 'c2' },
      update: {},
      create: {
        id: 'c2',
        name: 'פיתוח משחקים עם AI',
        description: 'יצירת משחקים תוך שילוב בינה מלאכותית',
        targetAudience: 'כיתות ה-ו',
        category: 'ai',
        isActive: true,
      },
    }),
    prisma.course.upsert({
      where: { id: 'c3' },
      update: {},
      create: {
        id: 'c3',
        name: 'רובוטיקה מתחילים',
        description: 'קורס רובוטיקה בסיסי',
        targetAudience: 'כיתות ד-ה',
        category: 'robotics',
        isActive: true,
      },
    }),
  ]);

  console.log(`✅ Created ${courses.length} courses`);

  // Create sample branches
  const branches = await Promise.all([
    prisma.branch.upsert({
      where: { id: 'b1' },
      update: {},
      create: {
        id: 'b1',
        name: 'בית ספר בן גוריון',
        type: 'school',
        city: 'באר שבע',
        address: 'רחוב בן גוריון 1',
        contactName: 'שרה כהן',
        contactPhone: '054-1234567',
        isActive: true,
      },
    }),
    prisma.branch.upsert({
      where: { id: 'b2' },
      update: {},
      create: {
        id: 'b2',
        name: 'מרכז עומר',
        type: 'frontal',
        city: 'עומר',
        address: 'מרכז מסחרי עומר',
        isActive: true,
      },
    }),
    prisma.branch.upsert({
      where: { id: 'b3' },
      update: {},
      create: {
        id: 'b3',
        name: 'אונליין',
        type: 'online',
        isActive: true,
      },
    }),
  ]);

  console.log(`✅ Created ${branches.length} branches`);

  // Create sample instructor
  const instructor = await prisma.instructor.upsert({
    where: { id: 'i1' },
    update: {},
    create: {
      id: 'i1',
      name: 'אריאל כהן',
      phone: '054-9876543',
      email: 'ariel@haitech.co.il',
      rateFrontal: 150,
      rateOnline: 120,
      isActive: true,
    },
  });

  console.log(`✅ Created instructor: ${instructor.name}`);

  // Create sample customer and student
  const customer = await prisma.customer.upsert({
    where: { id: 'cu1' },
    update: {},
    create: {
      id: 'cu1',
      name: 'דני לוי',
      phone: '050-1234567',
      email: 'dani@example.com',
      city: 'באר שבע',
    },
  });

  const student = await prisma.student.upsert({
    where: { id: 's1' },
    update: {},
    create: {
      id: 's1',
      customerId: customer.id,
      name: 'יואב לוי',
      grade: 'ד',
    },
  });

  console.log(`✅ Created customer: ${customer.name} with student: ${student.name}`);

  console.log('🎉 Seeding completed!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
