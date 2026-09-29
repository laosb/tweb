import blah, {blahStartupErrors, setBlahConfig} from '@config/blah';

async function bootstrap() {
  if(blah?.discovery) {
    const {connectDC, savedDC} = await import('@lib/blah/discovery');
    await Promise.all([1, 2, 3, 4].map(async(slot) => {
      try {
        const saved = await savedDC(slot);
        if(saved) setBlahConfig(slot, await connectDC(saved.domain, slot));
      } catch(error) {
        blahStartupErrors.set(slot, error instanceof Error ? error.message : String(error));
      }
    }));
  }
  await import('@/index');
}

void bootstrap();
