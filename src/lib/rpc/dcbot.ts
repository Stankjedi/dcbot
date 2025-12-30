import type { DcbotRpc } from '@/lib/rpc/types';
import { defineProxyService } from '@webext-core/proxy-service';

const SERVICE_NAME = 'dcbot';

const [, getService] = defineProxyService<DcbotRpc, []>(SERVICE_NAME, () => {
  throw new Error('Service not registered (background only).');
});

function stripThenable<T extends object>(value: T): T {
  return new Proxy(value as any, {
    get(target, prop, receiver) {
      // Prevent Promise/await from treating the proxy as thenable.
      if (prop === 'then') return undefined;
      return Reflect.get(target, prop, receiver);
    },
  }) as T;
}

// NOTE: @webext-core/proxy-service returns a thenable Proxy (it exposes a `then` property).
// If that value flows through Promise resolution (`await`, `Promise.resolve`, etc), JS will try to call `.then()`,
// which becomes an RPC call to a non-existent `then` method and can hang forever.
// We return a non-thenable wrapper to prevent that class of bugs.
export function getDcbotService(): DcbotRpc {
  return stripThenable(getService() as unknown as DcbotRpc);
}

export function registerDcbotService(init: () => DcbotRpc): void {
  const [registerService] = defineProxyService<DcbotRpc, []>(SERVICE_NAME, init);
  registerService();
}
