import blah, {blahStartupErrors, setBlahConfig} from '@config/blah';

async function bootstrap() {
  if(blah?.discovery) {
    const {refreshDC} = await import('@lib/blah/discovery');
    await Promise.all([1, 2, 3, 4].map(async(slot) => {
      try {
        const config = await refreshDC(slot);
        if(config) setBlahConfig(slot, config);
      } catch(error) {
        blahStartupErrors.set(slot, error instanceof Error ? error.message : String(error));
      }
    }));
  }
  await import('@/index');
}

void bootstrap();
