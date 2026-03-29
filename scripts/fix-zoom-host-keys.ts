import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Local host key mapping (same as in zoom.ts service)
const HOST_KEYS: Record<string, string> = {
  'hila@hai.tech': '576706',
  'alonad78@gmail.com': '161988',
  'shaul@hai.tech': '152303',
  'inna_grois@yahoo.com': '983810',
  'innagrois@gmail.com': '184874',
  'inna@hai.tech': '740578',
  'info@hai.tech': '296693',
  'hai.tech.teacher@gmail.com': '982294',
};

async function fixZoomHostKeys() {
  console.log('🔍 Fetching meetings with missing host keys...');
  
  const meetings = await prisma.meeting.findMany({
    where: {
      zoomMeetingId: { not: null },
      OR: [
        { zoomHostKey: null },
        { zoomHostKey: '' },
      ],
    },
    select: { id: true, zoomHostEmail: true, zoomMeetingId: true },
  });

  console.log(`Found ${meetings.length} meetings with missing host key`);

  let updated = 0;
  let skipped = 0;

  for (const meeting of meetings) {
    const email = meeting.zoomHostEmail?.toLowerCase();
    if (!email) { skipped++; continue; }

    const hostKey = HOST_KEYS[email];
    if (!hostKey) {
      console.log(`  ⚠️  No host key for email: ${email} (meeting ${meeting.id})`);
      skipped++;
      continue;
    }

    await prisma.meeting.update({
      where: { id: meeting.id },
      data: { zoomHostKey: hostKey },
    });
    console.log(`  ✅ Updated meeting ${meeting.id} (${email}) → ${hostKey}`);
    updated++;
  }

  // Also fix cycles
  console.log('\n🔍 Fetching cycles with missing host keys...');
  const cycles = await prisma.cycle.findMany({
    where: {
      zoomMeetingId: { not: null },
      OR: [
        { zoomHostKey: null },
        { zoomHostKey: '' },
      ],
    },
    select: { id: true, zoomHostEmail: true, zoomMeetingId: true },
  });

  console.log(`Found ${cycles.length} cycles with missing host key`);

  for (const cycle of cycles) {
    const email = cycle.zoomHostEmail?.toLowerCase();
    if (!email) { skipped++; continue; }

    const hostKey = HOST_KEYS[email];
    if (!hostKey) {
      console.log(`  ⚠️  No host key for email: ${email} (cycle ${cycle.id})`);
      skipped++;
      continue;
    }

    await prisma.cycle.update({
      where: { id: cycle.id },
      data: { zoomHostKey: hostKey },
    });
    console.log(`  ✅ Updated cycle ${cycle.id} (${email}) → ${hostKey}`);
    updated++;
  }

  console.log(`\n✅ Done: ${updated} updated, ${skipped} skipped`);
  await prisma.$disconnect();
}

fixZoomHostKeys().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
