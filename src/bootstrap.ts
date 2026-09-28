import blah from '@config/blah';

async function bootstrap() {
  if(blah?.discovery) {
    const {chooseDC} = await import('@lib/blah/chooseDC');
    Object.assign(blah, await chooseDC());
  }
  await import('@/index');
}

void bootstrap();
