import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const token = process.env.CAMERA_TOKEN || 'CAMERA_TESTE_123';

  const cam = await prisma.camera.upsert({
    where: { token },
    update: { name: 'Camera 01' },
    create: { name: 'Camera 01', token },
  });

  console.log('Camera OK:', cam);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
