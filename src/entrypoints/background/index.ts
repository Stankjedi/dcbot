export default defineBackground(() => {
  const start = async () => {
    const [{ registerDcbotService }, { createDcbotService }] = await Promise.all([
      import('@/lib/rpc/dcbot'),
      import('./service'),
    ]);

    registerDcbotService(() => createDcbotService());
    console.log('DCInside 디시봇 background ready', { id: browser.runtime.id });
  };

  start().catch((error) => {
    console.error('DCInside 디시봇 background failed to start', error);
  });
});
